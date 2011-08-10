/**
 * ArcusNode
 *  
 * Copyright 2011 OpenRTMFP
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License received along this program for more
 * details (or else see http://www.gnu.org/licenses/).
 *
 * Author: arcusdev <arcus.node@gmail.com>
 *
 * This file is a part of ArcusNode.
 */

var EventEmitter = require('events').EventEmitter;
var util = require('util');
var dgram = require('dgram');
var Packet = require('./packet.js');
var RTMFP = require('./rtmfp.js');
var NetConnection = require('./net_connection.js');
var NetGroup = require('./net_group.js');

/** 
 * The ArcusNode Server itself
 */
var ArcusNode = module.exports = function(settings) {
  
  var _self = this;
  
  var _settings = {
    manageInterval: 60, //seconds 
    connectionTimeout: 120000, //milliseconds
    groupTimeout: 360000, //milliseconds
    P2SKeepalive: 60000, //milliseconds, should be less then connectionTimeout, the timeout before the server sends a keepalive message to the client
    maxP2SKeepalive: 3, //How often to max keepalive the connection before dropping it
    port: 1935,
    address: '', //ArcusNode can be run on a specific interface if wanted
    logLevel: 'warn', //String: ['fatal', 'error', 'warn', 'info', 'debug']
    logFile: null,
    auth: false
  };
  
  //Merge Settings
  for(k in settings)
    _settings[k] = settings[k];
  
  //TODO: Gather stats (Outside this with events maybe?)
    
  var _logger;
  if(_settings.logger) {
    _logger = _settings.logger;
  } else {
    _logger = require('./node-logger/lib/logger.js').createLogger(_settings.logFile, _settings.logLevel);
  }
  
  //logger accessor
  this.logger = function() {
    return _logger;
  };
  
  var _rtmfp = new RTMFP();
  var _connections = {};
  var _handshakeConnections = {};
  var _connectionCounter = 0; //for temporary connection ids TODO: Replace with generated id
  var _endpointConnections = {};
  var _peerIdMap = {};
  var _groups = {};
  var _socket = null;
  var _manageInterval = null;
  var _hooks = {};
  var _commands = {};
  
  /**
   * The manage cycle checks for timeouts and does clean up
   */
  var _manageCycle = function(){
    try {
      var now = Date.now();
      
      //TODO: remove debug counts as soon as stats are implemented
      var counts = [0, 0, 0, 0, 0, 0];
      
      //manage connections
      //- Resends last message if availible for connection
      //- Sends keepalive to client before timeout
      //- Drops timed out connections
      var deadConnections = [];
      for(k in _connections)
      {
        counts[0]++;
        if((now - _connections[k].touched()) > _settings.P2SKeepalive)
        {
          if(_connections[k].keepalives() < _settings.maxP2SKeepalive)
          {
            _connections[k].keepalive();
            //TODO: Send P2S keepalive
          }
        }
        else if((now - _connections[k].touched()) > _settings.connectionTimeout)
        {
          deadConnections.push(_connections[k]);
          _connections[k].state(NetConnection.CLOSING);
        }
        else if(_connections[k].lastMessage())
        {
          _resend(_connections[k]);
        }
      }
      
      //Drop dead connections
      for(var i = 0; i < deadConnections.length; i++)
      {
        counts[1]++;
        _closeConnection(deadConnections[i]);
      }
      
      //cleanup handshake connections
      var deadHandshakes = [];
      for(k in _handshakeConnections)
      {
        counts[2]++;
        //Handshake connections don't need to be hold longer than a few seconds for opening a connection
        //In 99.9% of cases there should be nothing to do here
        if((now - _handshakeConnections[k].touched()) > _settings.connectionTimeout)
        {
          deadHandshakes.push(k);
        }
      }
      
      //Drop dead handshake connections
      for(var i = 0; i < deadHandshakes.length; i++)
      {
        counts[3]++;
        delete _handshakeConnections[deadHandshakes[i]];
      }
      
      //manage groups
      var deadGroups = [];
      for(k in _groups)
      {
        counts[4]++;
        if(_groups[k].size() == 0 && (now - _groups[k].touched()) > _settings.groupTimeout)
          deadGroups.push(_groups[k].id());
      }
      
      //Drop dead groups
      for(var i = 0; i < deadGroups.length; i++)
      {
        counts[5]++;
        delete _groups[deadGroups[i]];
      }
          
      _logger.debug('MANAGE CYCLE TIME: ' + (Date.now() - now) + 'ms');
      _logger.debug('#Connections: ' + counts[0] + ' #dropped NCs: ' + counts[1] + ' #handshake NCs: ' + counts[2] + ' #dropped hands. NCs: ' + counts[3]
        + ' #Groups: ' + counts[4] + ' #dropped groups: ' + counts[5]);
    } catch(e) {
      //TODO: handle error and recover
      _logger.error('Manage cycle error: ' + e.stack);
    }
  };
  
  /**
   * Resends the last message of the net connection
   */
  var _resend = function(nc) {
    if(nc.addresses.length > 0)
    {
      var resendPacket = new Packet(new Buffer(255), 0);
      _rtmfp.writePacket(resendPacket, nc.lastMessage());
      _rtmfp.encryptPacket(resendPacket, nc.encryptKey);
      _rtmfp.encodePacket(resendPacket, nc.clientConnectionId);
      send(resendPacket, nc.addresses[0]);
      nc.lastMessage(null);
    }
  }
  
  /**
   * Handles a received packet and puts all the rtmfp protocol stuff into logic
   *
   * @param {Buffer} buffer The received data from the socket
   * @param {remoteInfo} remoteInfo The endpoint of the received data
   */
  var _packetHandler = function(buffer, remoteInfo){
    
    var pkt = new Packet(buffer, buffer.length);
    //TODO: Validate packet (min 12 bytes, dividable by 4 for decryption)
    
    var connectionId = _rtmfp.decodePacket(pkt);
    
    var nc = (_connections[connectionId]) ? _connections[connectionId] : null;
    
    if(nc && nc.state() != NetConnection.CLOSING)
    {
      if(!_rtmfp.decryptPacket(pkt, nc.decryptKey))
      {
        _logger.warn('Decryption Failed!');
        return;
      }
      nc.touch();
      _logger.debug('Decrypted Packet: \n' + pkt.toString());
    } 
    else if(!nc && connectionId == 0)
    {
      if(!_rtmfp.decryptPacket(pkt, RTMFP.SYMETRIC_KEY))
      {
        _logger.warn('Handshake Decryption Failed!');
        return;
      }
      _logger.debug('Decrypted Handshake Packet: \n' + pkt.toString());
    } 
    else 
    {
      //Do nothing if connection not known
      //What does Cirrus say if connection is not known?
      //TODO: try redirect here
      return;
    }
    
    var messages = _rtmfp.readPacket(pkt);
    for(var i = 0; i < messages.length; i++){
      _handleMessage(nc, messages[i], remoteInfo);
    }
  };
  
  /**
   * Handle an incoming RTMFP message
   *
   * @param {NetConnection} nc The connection the message was received for
   * @param {object} message The message that was received and is handled here
   * @param {object} remoteInfo The remoteInfo object from the socket which is used for rendezvouz also
   */
  var _handleMessage = function(nc, message, remoteInfo) {
    message.remoteInfo = remoteInfo;
    
    //TODO: only really create packet when needed in this stage (before callback)
    var responsePacket = new Packet(new Buffer(255), 0).clear()
    
    //Update latency of nc
    if(message.latency > 0)
    {
      nc.latency(message.latency);
    }
    
    _logger.debug('Handling message type : ' + message.type);
      
    switch(message.type){
      //
      // HANDSHAKE_1
      //
      case RTMFP.HANDSHAKE_1:
        
        _logger.debug('Handshake URL: ' + message.url);
        
        nc = new NetConnection(++_connectionCounter);
        
        //Generate Cookie
        message.cookie = Packet.randomBytes(64);
        
        //Duplicate Cookie (otherwise it won't lookup later)
        nc.cookie = new Buffer(64);
        message.cookie.copy(nc.cookie, 0, 0, 64);
        
        //Create hook data
        var hookObj = { 
          message: message, 
          nc: nc, 
          remoteInfo: remoteInfo
        };
        
        if(_hook('handshake', hookObj) === false){
          //Stop handshake
          return;
        }
                
        _handshakeConnections[message.cookie] = nc;
        
        //emit handshake event here
        _self.emit('handshake', nc, message.url, remoteInfo);
        
        _rtmfp.writePacket(responsePacket, message);
                
        break;
              
      //
      // HANDSHAKE_2
      //
      case RTMFP.HANDSHAKE_2: {
        
        //Lookup net_connection for cookie
        nc = _handshakeConnections[message.cookie];
        
        if(nc)
        {
          if(nc.state() != NetConnection.HANDSHAKE)
            return;
          
          //the clientConnectionId is used to encode it to a response packet
          nc.clientConnectionId = message.connectionId;
          
          //This will be used by the client to encode it to a packet so the server can lookup connections
          message.connectionId = nc.id();
          
          //Set the peer id for the connection
          nc.peerId(message.peerId);
          
          nc.addresses.push(remoteInfo);
  
          var keys = _rtmfp.computeAsymetricKeys(message.clientKey, message.clientCertificate);
          
          message.serverKey = keys[0];
          nc.decryptKey = keys[1];
          nc.encryptKey = keys[2];
          
          //Just add the connection to all connections here
          _connections[nc.id()] = nc;
            
          _rtmfp.writePacket(responsePacket, message);
            
        } else {
          _logger.warn('Handshake Cookie not found!');
        }
        
        break;
      }
      
      //
      // NET_CONNECTION_OPEN
      //
      case RTMFP.NET_CONNECTION_OPEN:
        nc.state(NetConnection.CONNECTING);
          
        //remove cookie!
        delete _handshakeConnections[nc.cookie];
        delete nc.cookie;
        
        //Create hook data
        var hookObj = { 
          message: message, 
          nc: nc, 
          remoteInfo: remoteInfo
        };
        
        if(_hook('connect', hookObj) === false){
          //Stop connection
          return;
        }
        
        //Check if the NetConnection has been authenticated
        if(_settings.auth){
          if(!nc.authenticated()) {
            _closeConnection(nc);
            return;
          }
        }
        
        _rtmfp.writePacket(responsePacket, message);
        _rtmfp.writeAck(responsePacket, message.sequence, message.stage, true);
        
        //Response has to be acknowledged
        nc.lastMessage(message);
        
        //emit connect event here
        _self.emit('connect', nc, message.commandData[0]);
        
        break;
      
      //
      // NET_CONNECTION_ADDRESSES
      //
      case RTMFP.NET_CONNECTION_ADDRESSES:
        
        //Reset addresses
        if(nc.addresses.length > 0)
        {
          delete _endpointConnections[nc.addresses[0]];
          nc.addresses = [];
        }
        
        //Add public address
        nc.addresses.push(remoteInfo);
        
        //Add private addresses to nc
        nc.addresses = nc.addresses.concat(message.addresses);
                    
        _endpointConnections[remoteInfo] = nc;
        
        //Create hook data
        var hookObj = { 
          message: message, 
          nc: nc, 
          remoteInfo: remoteInfo
        };
        
        if(_hook('address', hookObj) === false){
          //Stop address command
          return;
        }
        
        //emit address event here
        _self.emit('address', nc);
                
        if(nc.state() == NetConnection.CONNECTING)
        {
          nc.state(NetConnection.CONNECTED);
          
          //Map peer id to connection in server for rendevouz lookup
          _peerIdMap[nc.peerId()] = nc;
          
          //Response has to be acknowledged
          nc.lastMessage(message);
        }
        
        _rtmfp.writePacket(responsePacket, message);
        _rtmfp.writeAck(responsePacket, message.sequence, message.stage, true);
        
        break;
      
      //
      // COMMAND (RPC)
      //
      case RTMFP.COMMAND:
        
        //Create hook data
        var hookObj = { 
          message: message, 
          nc: nc, 
          remoteInfo: remoteInfo
        };
        
        if(_hook('command', hookObj) === false){
          //Stop command
          return;
        }
        
        //Send ACK immediately
        _sendResponse(message, nc, _rtmfp.writePacket(new Packet(new Buffer(32), 0).clear(), { 
          type: RTMFP.ACK, 
          sentTime: message.sentTime,
          sequence: message.sequence,
          stage: message.stage
        }), remoteInfo);
        
        //Call registered command (if given) with arguments from AMF 
        //-> if command is not registered, return error message to client
        if(typeof _commands[message.commandName] === 'object') {
          //Call command callback async
          (function(handler, nc, message, arcus){
            process.nextTick(function() {
              var result = handler.method.apply(handler.context, [nc].concat(message.commandData));
              arcus.commandResult(nc, message, result);
            });
          })(_commands[message.commandName], nc, message, _self);
        } else {
          //Let commands fail by default if there is no handler
          message.type = RTMFP.COMMAND_ERROR;
          message.statusDescription = 'No command handler';
          _rtmfp.writePacket(responsePacket, message);
        }
                        
        //emit command event here
        _self.emit('command', nc, message.commandName, message.commandData);
                
        break;
                
      //
      // NET_CONNECTION_CLOSE
      //
      case RTMFP.NET_CONNECTION_CLOSE:
        if(nc.state() != NetConnection.CLOSING)
        {
          //emit disconnect event
          _self.emit('disconnect', nc, message.commandName, message.commandData);
        }
        break;
      
      //
      // NET_GROUP_JOIN
      //
      case RTMFP.NET_GROUP_JOIN:
          
        //Check if group exists, else create one
        var group = (_groups[message.groupId]) ? _groups[message.groupId] : _groups[message.groupId] = new NetGroup(message.groupId);
        
        if(group.size() > 0)
        {
          //Get fastest connections to send to client
          message.peers = group.fastest(nc);
          
          //Response has to be acknowledged
          nc.lastMessage(message);
        }
        
        //Add connection to group
        group.add(nc);
        
        //Track group in connection
        nc.join(message.sequence, group);
        
        _rtmfp.writePacket(responsePacket, message);
        
        break;
      
      //
      // NET_GROUP_LEAVE
      //
      case RTMFP.NET_GROUP_LEAVE:
        //Leave group on connection with sequence number
        var group = nc.leave(message.sequence);
        
        if(group)
        {
          group.remove(nc.id());
        }
        
        _rtmfp.writePacket(responsePacket, message);
        
        break;
      
      //
      // RENDEZVOUZ
      //
      case RTMFP.RENDEZVOUZ:
        //Lookup requested peer
        var peer = _peerIdMap[message.peerId];
          
        if(peer)
        {
          _logger.debug('Found requested peer for rendezvouz');
          
          //Send private parts of peer to requester
          message.addresses = peer.addresses;
          
          var requesterResponse = new Packet(new Buffer(255), 0);
          _rtmfp.writePacket(requesterResponse, message);
          
          _rtmfp.encryptPacket(requesterResponse, RTMFP.SYMETRIC_KEY);
          _rtmfp.encodePacket(requesterResponse, 0);
          send(requesterResponse, remoteInfo);
          
          //Inform peer about newcomer
          var newcomerMessage = { type: RTMFP.RENDEZVOUZ_2};
          newcomerMessage.tag = message.tag;
          newcomerMessage.peer = peer;
          
          //Question: If there is no NetConnection for the remote endpoint the message is coming from,
          //then the requester does not have a valid NetConnection to this server.
          //So the rendezvouz request would be invalid? Or do we allow rendezvouz without valid NetConnection?
          var requester = _endpointConnections[remoteInfo];
          if(requester)
          {
            //We can iterate through private addresses to tell the peer about
            newcomerMessage.address = requester.nextAddress(newcomerMessage.tag);
            if(requester.addresses[0].address == peer.addresses[0].address)
            {
              newcomerMessage.address = requester.nextAddress(newcomerMessage.tag);
            }
            newcomerMessage.peer = requester;
          } else {
            newcomerMessage.address = remoteInfo;
          }
          
          if(peer.addresses.length > 0 && newcomerMessage.address != undefined)
          {
            var directResponse = new Packet(new Buffer(255), 0);
            _rtmfp.writePacket(directResponse, newcomerMessage);
            _logger.debug('Rendezvouz newcomer response: \n' + directResponse.toString());
            _rtmfp.encryptPacket(directResponse, peer.encryptKey);
            //TODO: create client connection id getter/setter in NetConnection 
            _rtmfp.encodePacket(directResponse, peer.clientConnectionId);
            send(directResponse, peer.addresses[0]);
          }
        }
        
        break;
      
      //
      // KEEPALIVE
      //
      case RTMFP.KEEPALIVE:
        _rtmfp.writePacket(responsePacket, message);
        break;
        
      //
      // KEEPALIVE_RESPONSE
      //
      case RTMFP.KEEPALIVE_RESPONSE:
        //Do nothing for now. If client replied on server keepalive, 
        //the connection was already touched at this point 
        break;
        
      //
      // ACK
      //
      case RTMFP.ACK:
        //if last sequence response in net_connection is acknowledged,
        //remove it so it doesn't get sent again
        
        if(nc.lastMessage() && nc.lastMessage().sequence == message.sequence 
          && nc.lastMessage().stage == message.stage)
        {
          nc.lastMessage(null);
        }
        
        //maybe keep messages in a list as message/NetConnection pairs,
        //and give the message a state and if acknowledged it is set to received
        //then it doesn't get sent again in the manage cycle,
        //to keep more than one message (unsure if needed to keep more than one message)
        
      //
      // NOT_ACK
      //
      case RTMFP.NOT_ACK:
        //At the moment we just keep one last message, nack not really needed
        //TODO: Could increment nack counter on message to remove if reached X
        break;
      
      //
      // UNKNOWN_0x5e
      //
      case RTMFP.UNKNOWN_0x5e:
        _rtmfp.writePacket(responsePacket, message);
        break;
        
      default:
        _logger.error('Unhandled message: ' + pkt.toString());
        break;
      
    }
    
    //If availible, send the response 
    _sendResponse(message, nc, responsePacket, remoteInfo);
  };
  
  /**
   * Answer a command that was called by the client
   *
   * @param {NetConnection} nc The NetConnection which the command was called from
   * @param {object} message The message that contained the command
   * @param {mixed} result The result of the command callback which is returned to the other side
   */
  this.commandResult = function(nc, message, result) {
    var pktBuffer = new Buffer(255);
    pktBuffer.fill(0);
    var responsePacket = new Packet(pktBuffer, 0);
    message.type = RTMFP.COMMAND_RESULT;
    message.commandData = result;
    _rtmfp.writePacket(responsePacket, message);
    _sendResponse(message, nc, responsePacket, message.remoteInfo);
  };
  
  /**
   * Encode, encrypt and send a response packet
   * TODO: refactor to pack(nc, pkt, ncId), do send separated
   */
  var _sendResponse = function(message, nc, responsePacket, remoteInfo){
    if(nc && responsePacket.size() > 11)
    {
      if(nc.state() != NetConnection.HANDSHAKE){
        _logger.debug('Normal Response to ' + remoteInfo.address + ':' + remoteInfo.port + ': \n' + responsePacket.toString());
        _rtmfp.encryptPacket(responsePacket, nc.encryptKey);
      } else {
        _logger.debug('Handshake Response to ' + remoteInfo.address + ':' + remoteInfo.port + ': \n' + responsePacket.toString());
        _rtmfp.encryptPacket(responsePacket, RTMFP.SYMETRIC_KEY);
      }
      
      //TODO: encode if nc.clientConnectionId given, will only be set afer HANDSHAKE_1, so...
      if(message.type != RTMFP.HANDSHAKE_1)
      {
        _rtmfp.encodePacket(responsePacket, nc.clientConnectionId);
      } else {
        _rtmfp.encodePacket(responsePacket, 0);
      }
      
      //TODO: move to send with pack refactor
      if(nc.addresses.length > 0) {
        send(responsePacket, nc.addresses[0]);
      } else {
        send(responsePacket, remoteInfo);
      }
    } 
  };
  
  /**
   * Send a packet to a given remote endpoint
   */
  var send = function(packet, endpoint) {
    _socket.send(packet.buffer(), 0, packet.size(), endpoint.port, endpoint.address, function (err, bytes) {
        if (err) {
          //TODO: Handle error and recover
          throw err;
        }
        _logger.debug('Wrote ' + bytes + ' bytes to socket.');
    });
  };
    
  /**
   * Trigger a hook
   *
   * @param {String} name The Name of the hook to call
   * @param {Object} obj The object with data the hook gets
   */
  var _hook = function(name, obj) {
    if(typeof _hooks[name] !== 'object') {
      return true;
    }
    return _hooks[name].method.call(_hooks[name].context, obj);
  };
  
  /**
   * Register a hook
   *
   * @param {string} name The name of the hook to register the callback for
   * @param {callback} callback A valid Callback that gets the data for the hook and can control the protocol flow
   */
  this.hook = function(name, callback){
    _hooks[name] = _validCallback(callback);
    
    //Allow chaining
    return this;
  };
  
  /**
   * Register a command that can then be called by the client with NetConnection#call
   *
   * @param {string} name The name for the command that can be called by the client
   * @param {callback} callback A valid callback that will handle the command, its return value is sent to the client
   */
  this.command = function(name, callback){
    
    _commands[name] = _validCallback(callback);
    
    //Allow chaining
    return this;
  };
  
  //Synonyms for ArcusNode#command
  this.onCommand = this.registerCommand = this.addCommand = this.com = this.command;
  
  /**
   * Validate a callback as either a function or an object with a method and a context
   *
   * @param {function,object} callback The callback to validate
   */
  var _validCallback = function(callback){
    if(typeof callback !== 'object' && typeof callback !== 'function'){
      throw new Error('A hook has to be either a function or an object with method and context.');
    }
    if(typeof callback === 'object' && (typeof callback.method !== 'function' || typeof callback.context !== 'object')){
      throw new Error('A hook callback object needs method as function and context as object.');
    }
    if(typeof callback === 'function') {
      return {
        method: callback,
        context: this
      };
    }
    return callback;
  };
  
  /**
   * Close a client connection and do needed cleanup
   */
  var _closeConnection = function(nc){
    if(nc.state() != NetConnection.CLOSING) {
      //Removes connection from all joined groups
      nc.close();
      
      //Remove connection from peer id map
      delete _peerIdMap[nc.peerId()];
      
      //Remove connection from endpoint map
      if(nc.addresses.length > 0) {
        delete _endpointConnections[nc.addresses[0]];
      }
      
      //Remove cookie if existent
      if(nc.cookie) {
        delete _handshakeConnections[nc.cookie];
      }
      
      //Remove from connections
      delete _connections[nc.id()];
              
      //Send close message to connection
      _sendClosePacket(nc);
    }
  };
  
  /**
   * Send a close message to the NetConnection 
   *
   * @param {NetConnection} nc The connection to close
   */
  var _sendClosePacket = function(nc) {
    if(nc.addresses.length > 0) {
      var pkt = new Packet(new Buffer(32));
      _rtmfp.writePacket(pkt, { type: RTMFP.NET_CONNECTION_CLOSE });
      _rtmfp.encryptPacket(pkt, nc.encryptKey);
      _rtmfp.encodePacket(pkt, nc.clientConnectionId);
      send(pkt, nc.addresses[0]);
    }
  };
  
  /**
   * Startup ArcusNode and listen for connections
   */
  this.run = function() {
  
    //Start manage cycle
    _manageInterval = setInterval(_manageCycle, _settings.manageInterval * 1000);
    
    //Listen for connections
    //TODO: Support IPv6
    _socket = dgram.createSocket('udp4', function(buffer, remoteInfo){
      //Main Handler
      try {
        _packetHandler(buffer, remoteInfo);
      } catch(e) {
        //TODO: handle error and recover
        _logger.error('Socket message handler error: ' + e.stack);
      }
    });
    _socket.bind(_settings.port, _settings.address);
    
  };
  
  /**
   * Get address ArcusNode is running on
   *
   * @return {object} Returns the sockets address
   */
  this.address = function(){
    return _socket.address();
  };
  
  /**
   * Stop ArcusNode
   */
  this.stop = function() {
    
    clearInterval(_manageInterval);
    _manageCycle();
    
    //Close Connections
    for(k in _connections) {
      _closeConnection(_connections[k]);
    }
    
    _socket.close();
    
  };
  
};

//Inherit from EventEmitter
ArcusNode.prototype.__proto__ = EventEmitter.prototype;
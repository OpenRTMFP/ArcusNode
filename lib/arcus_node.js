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
var URL = require('url');

var Packet = require('./packet.js');
var RTMFP = require('./rtmfp.js');
var NetConnection = require('./net_connection.js');
var NetGroup = require('./net_group.js');

/** 
 * The ArcusNode Server itself
 */
var ArcusNode = module.exports = function(settings) {
  
  var _self = this;
  
  /**
   * Private Attributes (most of them should not be messed with directly, unless you really know what you do)
   */
  var __p = this.__p = {};
  
  __p.settings = {
    manageInterval: 60, //seconds 
    connectionTimeout: 120000, //milliseconds
    groupTimeout: 360000, //milliseconds
    serverKeepalive: 60000, //milliseconds, should be less then connectionTimeout, the timeout before the server sends a keepalive message to the client
    clientKeepalive: 60000, //will tell the client in what interval it should send keepalive messages
    maxKeepalives: 3, //How often to max keepalive the connection before dropping it
    port: 1935,
    address: '', //ArcusNode can be run on a specific interface if wanted
    logLevel: 'warn', //String: ['fatal', 'error', 'warn', 'info', 'debug']
    logFile: null,
    auth: false,
    rootConnections: true
  };
  
  //Merge Settings
  for(k in settings)
    _settings[k] = settings[k];
  
  //TODO: Gather stats (Outside this with events maybe?)
    
  if(__p.settings.logger) {
    __p.logger = __p.settings.logger;
  } else {
    __p.logger = require('./node-logger/lib/logger.js').createLogger(__p.settings.logFile, __p.settings.logLevel);
  }
  
  __p.rtmfp = new RTMFP();
  __p.connections = {};
  __p.handshakeConnections = {};
  __p.connectionCounter = 0; //for temporary connection ids TODO: Replace with generated id
  __p.endpointConnections = {};
  __p.peerIdMap = {};
  __p.groups = {};
  __p.socket = null;
  __p.manageInterval = null;
  __p.commands = {};
  __p.running = false;
  __p.supportedProtocols = ['rtmfp:'];
  __p.startTime = 0;
  
  //access plugins
  this.plugins = [];
  
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
      
      for(k in __p.connections)
      {
        counts[0]++;
        //TODO: Touched may not be the last cable interaction for that connection
        if((now - __p.connections[k].touched()) > __p.settings.serverKeepalive)
        {
          if(__p.connections[k].keepalives() < __p.settings.maxKeepalives)
          {
            __p.connections[k].keepalive();
            //TODO: Send P2S keepalive
          }
        }
        else if((now - __p.connections[k].touched()) > __p.settings.connectionTimeout)
        {
          deadConnections.push(__p.connections[k]);
          __p.connections[k].state(NetConnection.CLOSING);
        }
        else if(__p.connections[k].lastMessage())
        {
          _resend(__p.connections[k]);
        }
      }
      
      //Drop dead connections
      for(var i = 0; i < deadConnections.length; i++)
      {
        counts[1]++;
        __p.closeConnection(deadConnections[i]);
      }
      
      //cleanup handshake connections
      var deadHandshakes = [];
      for(k in __p.handshakeConnections)
      {
        counts[2]++;
        //Handshake connections don't need to be hold longer than a few seconds for opening a connection
        //In 99.9% of cases there should be nothing to do here
        if((now - __p.handshakeConnections[k].touched()) > __p.settings.connectionTimeout)
        {
          deadHandshakes.push(k);
        }
      }
      
      //Drop dead handshake connections
      for(var i = 0; i < deadHandshakes.length; i++)
      {
        counts[3]++;
        delete __p.handshakeConnections[deadHandshakes[i]];
      }
      
      //manage groups
      var deadGroups = [];
      for(k in __p.groups)
      {
        counts[4]++;
        if(__p.groups[k].size() == 0 && (now - __p.groups[k].touched()) > __p.settings.groupTimeout)
          deadGroups.push(__p.groups[k].id());
      }
      
      //Drop dead groups
      for(var i = 0; i < deadGroups.length; i++)
      {
        counts[5]++;
        delete __p.groups[deadGroups[i]];
      }
          
      __p.logger.debug('MANAGE CYCLE TIME: ' + (Date.now() - now) + 'ms');
      __p.logger.debug('#Connections: ' + counts[0] + ' #dropped NCs: ' + counts[1] + ' #handshake NCs: ' + counts[2] + ' #dropped hands. NCs: ' + counts[3]
        + ' #Groups: ' + counts[4] + ' #dropped groups: ' + counts[5]);
    } catch(e) {
      //TODO: handle error and recover
      __p.logger.error('Manage cycle error: ' + e.stack);
    }
  };
  
  /**
   * Resends the last message of the net connection
   * TODO: resend only if last message is available
   * TODO: Move to NetConnection and use arcus.send();
   *
   * @param {NetConnection}
   */
  var _resend = function(nc) {
    if(nc.addresses.length > 0)
    {
      var resendPacket = new Packet(255);
      __p.rtmfp.writePacket(resendPacket, nc.lastMessage());
      __p.rtmfp.encryptPacket(resendPacket, nc.encryptKey);
      __p.rtmfp.encodePacket(resendPacket, nc.clientConnectionId);
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
    
    var connectionId = __p.rtmfp.decodePacket(pkt);
    
    var nc = (__p.connections[connectionId]) ? __p.connections[connectionId] : null;
    
    if(nc && nc.state() != NetConnection.CLOSING)
    {
      if(!__p.rtmfp.decryptPacket(pkt, nc.decryptKey))
      {
        __p.logger.warn('Decryption Failed!');
        return;
      }
      nc.touch();
      __p.logger.debug('Decrypted Packet: \n' + pkt.toString());
    } 
    else if(!nc && connectionId == 0)
    {
      if(!__p.rtmfp.decryptPacket(pkt, RTMFP.SYMETRIC_KEY))
      {
        __p.logger.warn('Handshake Decryption Failed!');
        return;
      }
      __p.logger.debug('Decrypted Handshake Packet: \n' + pkt.toString());
    } 
    else 
    {
      //Do nothing if connection not known
      //What does Cirrus say if connection is not known?
      //TODO: try redirect here
      return;
    }
    
    var messages = __p.rtmfp.readPacket(pkt);
    for(var i = 0; i < messages.length; i++){
      _handleMessage(nc, messages[i], remoteInfo, pkt);
    }
  };
  
  /**
   * Handle an incoming RTMFP message
   *
   * @param {NetConnection} nc The connection the message was received for
   * @param {object} message The message that was received and is handled here
   * @param {object} remoteInfo The remoteInfo object from the socket which is used for rendezvouz also
   */
  var _handleMessage = function(nc, message, remoteInfo, pkt) {
    message.remoteInfo = remoteInfo;
    
    //Update latency of nc
    if(message.latency > 0)
    {
      nc.latency(message.latency);
    }
    
    //TODO: save last sentTime and timestamp with netconnection to decide if to send with echo time or not
    //nc.lastPacketTime = message.sentTime; nc.lastPacketReceived = Date.now();
    if(nc && message.sentTime){
      nc.lastPacketTime = message.sentTime;
    }
    
    switch(message.type){
      //
      // HANDSHAKE_REQUEST
      //
      case RTMFP.HANDSHAKE_REQUEST:
        
        //validate protocol in handshake url
        var url = URL.parse(message.url, false);
        if(__p.supportedProtocols.indexOf(url.protocol.toLowerCase()) == -1){
          //Ignore handshake request for unsupported protocols
          return;
        }
        
        nc = new NetConnection(++__p.connectionCounter);
        
        //Generate Cookie
        message.cookie = Packet.randomBytes(64);
        
        //Duplicate Cookie (otherwise it won't lookup later)
        nc.cookie = new Buffer(64);
        message.cookie.copy(nc.cookie, 0, 0, 64);
        
        message.certificate = nc.getCertificate();
        
        __p.handshakeConnections[message.cookie] = nc;
        
        //emit handshake event here
        _self.emit('handshake', nc, message.url, remoteInfo);
                
        //Create Response
        if(nc.state() == NetConnection.HANDSHAKE){
          message.type = RTMFP.HANDSHAKE_RESPONSE;
          var responsePacket = new Packet(255);
          __p.rtmfp.writePacket(responsePacket, message);
        }
        
        break;
              
      //
      // KEY_REQUEST
      //
      case RTMFP.KEY_REQUEST: {
        
        //Lookup net_connection for cookie
        nc = __p.handshakeConnections[message.cookie];
        
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
  
          //Do key exchange
          nc.generateKeyPair();
          nc.computeSharedSecret(message.publicKey);
          message.publicKey = nc.getPublicKey();
          
          var serverNonce = __p.rtmfp.createServerNonce(nc.getPublicKey());
          nc.computeAsymetricKeys(message.clientCertificate, serverNonce);
           
          //Just add the connection to all connections here
          __p.connections[nc.id()] = nc;
          
          message.type = RTMFP.KEY_RESPONSE
          var responsePacket = new Packet(255);
          __p.rtmfp.writePacket(responsePacket, message);
            
        } else {
          __p.logger.warn('Handshake Cookie not found!');
        }
        
        break;
      }
      
      //
      // NET_CONNECTION_REQUEST
      //
      case RTMFP.NET_CONNECTION_REQUEST:
        nc.state(NetConnection.CONNECTING);
        
        //TODO: send NC_FAILED_REQUEST if parameters are not matching
        
        //remove cookie!
        delete __p.handshakeConnections[nc.cookie];
        delete nc.cookie;
        
        //emit connect event here
        _self.emit('connect', nc, message.commandData[0]);
        
        if(nc.state() == NetConnection.CONNECTING){
          //Check if the NetConnection has been authenticated
          if(__p.settings.auth){
            if(!nc.authenticated()) {
              //TODO: fail connection instead of close on auth error
              _closeConnection(nc);
              return;
            }
          }
        
          message.type = RTMFP.NET_CONNECTION_RESPONSE
          var responsePacket = new Packet(255);
          __p.rtmfp.writePacket(responsePacket, message);
          __p.rtmfp.writeAck(responsePacket, message.sequence, message.stage, true);
          
          //Response has to be acknowledged
          nc.lastMessage(message);
        }
                
        break;
      
      //
      // NET_CONNECTION_ADDRESSES
      //
      case RTMFP.NET_CONNECTION_ADDRESSES:
        
        //Reset addresses
        if(nc.addresses.length > 0)
        {
          delete __p.endpointConnections[nc.addresses[0]];
          nc.addresses = [];
        }
        
        //Add public address
        //TODO: save public/private marker with addresses
        nc.addresses.push(remoteInfo);
        
        //Add private addresses to nc
        nc.addresses = nc.addresses.concat(message.addresses);
                    
        __p.endpointConnections[remoteInfo] = nc;
        
        
        //emit address event here
        _self.emit('address', nc);
                
        if(nc.state() == NetConnection.CONNECTING)
        {
          nc.state(NetConnection.CONNECTED);
          
          //Map peer id to connection in server for rendevouz lookup
          __p.peerIdMap[nc.peerId()] = nc;
          
          //Response has to be acknowledged
          nc.lastMessage(message);
        
          message.serverKeepalive = __p.settings.serverKeepalive;
          message.clientKeepalive = __p.settings.clientKeepalive;
          
          var responsePacket = new Packet(255);
          __p.rtmfp.writePacket(responsePacket, message);
          __p.rtmfp.writeAck(responsePacket, message.sequence, message.stage, true);
        }
        
        break;
      
      //
      // COMMAND (RPC)
      //
      case RTMFP.COMMAND:
        
        //Send ACK immediately
        _sendResponse(message, nc, __p.rtmfp.writePacket(new Packet(32), { 
          type: RTMFP.ACK, 
          sentTime: message.sentTime,
          sequence: message.sequence,
          stage: message.stage
        }), remoteInfo);
        
        //TODO: route commands to app (if app is not given for NetConnection, invoke on _root)
        //Call registered command (if given) with arguments from AMF 
        //-> if command is not registered, return error message to client
        if(typeof __p.commands[message.commandName] === 'object') {
          //Call command callback async
          (function(handler, nc, message, arcus){
            process.nextTick(function() {
              var result = handler.method.apply(handler.context, [nc].concat(message.commandData));
              arcus.commandResult(nc, message, result);
            });
          })(__p.commands[message.commandName], nc, message, _self);
        } else {
          //Let commands fail by default if there is no handler
          message.type = RTMFP.COMMAND_ERROR;
          message.statusDescription = 'Method not found(' + message.commandName + ')';
          var responsePacket = new Packet(255);
         __p.rtmfp.writePacket(responsePacket, message);
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
          _closeConnection(nc);
        }
        break;
      
      //
      // NET_GROUP_JOIN
      //
      case RTMFP.NET_GROUP_JOIN:
          
        //Check if group exists, else create one
        var group = (__p.groups[message.groupId]) ? __p.groups[message.groupId] : __p.groups[message.groupId] = new NetGroup(message.groupId);
        
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
        
        var responsePacket = new Packet(255);
        __p.rtmfp.writePacket(responsePacket, message);
        
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
        
        var responsePacket = new Packet(255);
        __p.rtmfp.writePacket(responsePacket, message);
        
        break;
      
      //
      // RENDEZVOUZ_REQUEST
      //
      case RTMFP.RENDEZVOUZ_REQUEST:
        //Lookup requested peer
        //TODO: handle more than one peerId
        var peer;
        for(var peerNum = 0; peerNum < message.peerIds.length; peerNum++){
          peer = __p.peerIdMap[message.peerIds[peerNum]];
          if(peer)
          {
            //TODO: check what FMS says on peer id not found
            
            //Send private parts of peer to requester
            message.addresses = peer.addresses;
            
            //Create response
            message.type = RTMFP.RENDEZVOUZ_RESPONSE;
            var requesterResponse = new Packet(255);
            __p.rtmfp.writePacket(requesterResponse, message);
            
            //Inform peer about newcomer
            var newcomerMessage = { type: RTMFP.RENDEZVOUZ_NEWCOMER};
            newcomerMessage.tag = message.tag;
            newcomerMessage.peerId = peer.peerId();
            
            //Question: If there is no NetConnection for the remote endpoint the message is coming from,
            //then the requester does not have a valid NetConnection to this server.
            //So the rendezvouz request would be invalid? Or do we allow rendezvouz without valid NetConnection?
            var requester = __p.endpointConnections[remoteInfo];
            newcomerMessage.pp = true;
            if(requester)
            {
              //We can iterate through private addresses to tell the peer about
              //-> TODO: Check validity, makes always two steps if public addresses are the same
              newcomerMessage.address = requester.nextAddress(newcomerMessage.tag);
              if(requester.addresses[0].address == peer.addresses[0].address)
              {
                newcomerMessage.address = requester.nextAddress(newcomerMessage.tag);
                newcomerMessage.pp = false;
              }
            } else {
              newcomerMessage.address = remoteInfo;
            }
            
            newcomerMessage.echoTime = peer.lastPacketTime;
            
            if(peer.addresses.length > 0 && newcomerMessage.address != undefined)
            {
              var directResponse = new Packet(255);
              __p.rtmfp.writePacket(directResponse, newcomerMessage);
              __p.logger.debug('Rendezvouz newcomer response: \n' + directResponse.toString());
              __p.rtmfp.encryptPacket(directResponse, peer.encryptKey);
              //TODO: create client connection id getter/setter in NetConnection 
              __p.rtmfp.encodePacket(directResponse, peer.clientConnectionId);
              send(directResponse, peer.addresses[0]);
            }
            
            __p.logger.debug('Rendezvouz requester response: ' + requesterResponse.toString());
            
            __p.rtmfp.encryptPacket(requesterResponse, RTMFP.SYMETRIC_KEY);
            __p.rtmfp.encodePacket(requesterResponse, 0);
            
            send(requesterResponse, remoteInfo);
          }
        }
        break;
      
      //
      // KEEPALIVE_REQUEST
      //
      case RTMFP.KEEPALIVE_REQUEST:
        message.type = RTMFP.KEEPALIVE_RESPONSE;
        var responsePacket = new Packet(32);
        __p.rtmfp.writePacket(responsePacket, message);
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
      // NC_FAILED_REQUEST
      //
      case RTMFP.NC_FAILED_REQUEST:
        message.type = RTMFP.NC_FAILED_RESPONSE
        var responsePacket = new Packet(255);
        __p.rtmfp.writePacket(responsePacket, message);
        break;
        
      default:
        __p.logger.error('Unhandled message: ' + pkt.toString());
        break;
      
    }
    
    //If availible, send the response
    if(responsePacket){
      _sendResponse(message, nc, responsePacket, remoteInfo);
    }
  };
  
  /**
   * Answer a command that was called by the client
   *
   * @param {NetConnection} nc The NetConnection which the command was called from
   * @param {object} message The message that contained the command
   * @param {mixed} result The result of the command callback which is returned to the other side
   */
  this.commandResult = function(nc, message, result) {
    var responsePacket = new Packet(255);
    message.type = RTMFP.COMMAND_RESULT;
    message.commandData = result;
    __p.rtmfp.writePacket(responsePacket, message);
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
        __p.logger.debug('Normal Response to ' + remoteInfo.address + ':' + remoteInfo.port + ': \n' + responsePacket.toString());
        __p.rtmfp.encryptPacket(responsePacket, nc.encryptKey);
      } else {
        __p.logger.debug('Handshake Response to ' + remoteInfo.address + ':' + remoteInfo.port + ': \n' + responsePacket.toString());
        __p.rtmfp.encryptPacket(responsePacket, RTMFP.SYMETRIC_KEY);
      }
      
      //TODO: encode if nc.clientConnectionId given, will only be set afer HANDSHAKE_1, so...
      if(message.type != RTMFP.HANDSHAKE_1)
      {
        __p.rtmfp.encodePacket(responsePacket, nc.clientConnectionId);
      } else {
        __p.rtmfp.encodePacket(responsePacket, 0);
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
    if(__p.running) {
      __p.socket.send(packet.buffer(), 0, packet.size(), endpoint.port, endpoint.address, function (err, bytes) {
          if (err) {
            //TODO: Handle error and recover
            throw err;
          }
          __p.logger.debug('Wrote ' + bytes + ' bytes to socket.');
      });
    } 
  };
    
  /**
   * Register a command that can then be called by the client with NetConnection#call
   *
   * @param {string} name The name for the command that can be called by the client
   * @param {callback} callback A valid callback that will handle the command, its return value is sent to the client
   * @return {ArcusNode} for chaining
   */
  this.command = function(name, callback){
    
    __p.commands[name] = _validCallback(callback);
    
    //Allow chaining
    return this;
  };
  
  //Synonyms for ArcusNode#command
  this.onCommand = this.command;
  
  /**
   * Validate a callback as either a function or an object with a method and a context
   *
   * @param {function,object} callback The callback to validate
   * @return {object} The validated callback with method and context
   */
  var _validCallback = function(callback){
    if(typeof callback !== 'object' && typeof callback !== 'function'){
      throw new Error('A callback has to be either a function or an object with method and context.');
    }
    if(typeof callback === 'object' && (typeof callback.method !== 'function' || typeof callback.context !== 'object')){
      throw new Error('A callback object needs method as function and context as object.');
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
   *
   * @param {NetConnection} nc
   * @return {Boolean} True if the connection was closed, false if it was already closing
   */
  var _closeConnection = function(nc){
    if(nc.state() != NetConnection.CLOSING) {
      //Removes connection from all joined groups
      nc.close();
      
      //Remove connection from peer id map
      delete __p.peerIdMap[nc.peerId()];
      
      //Remove connection from endpoint map
      if(nc.addresses.length > 0) {
        delete __p.endpointConnections[nc.addresses[0]];
      }
      
      //Remove cookie if existent
      if(nc.cookie) {
        delete __p.handshakeConnections[nc.cookie];
      }
      
      //Remove from connections
      delete __p.connections[nc.id()];
              
      //Send close message to connection
      _sendClosePacket(nc);
      
      return true;
    }
    return false;
  };
  
  /**
   * Send a close message to the NetConnection 
   *
   * @param {NetConnection} nc The connection to close
   */
  var _sendClosePacket = function(nc) {
    if(nc.addresses.length > 0) {
      var pkt = new Packet(new Buffer(32));
      __p.rtmfp.writePacket(pkt, { type: RTMFP.NET_CONNECTION_CLOSE });
      __p.rtmfp.encryptPacket(pkt, nc.encryptKey);
      __p.rtmfp.encodePacket(pkt, nc.clientConnectionId);
      send(pkt, nc.addresses[0]);
    }
  };
  
  /**
   * Startup ArcusNode and listen for connections
   *
   * @return {ArcusNode}
   */
  this.run = function() {
    
    //Emit start event
    this.emit('start', this);
    
    //Start manage cycle
    __p.manageInterval = setInterval(_manageCycle, __p.settings.manageInterval * 1000);
    
    //Listen for connections
    //TODO: Support IPv6
    __p.socket = dgram.createSocket('udp4', function(buffer, remoteInfo){
      //Main Handler
      try {
        _packetHandler(buffer, remoteInfo);
      } catch(e) {
        //TODO: handle error and recover
        __p.logger.error('Socket message handler error: ' + e.stack);
      }
    });
    __p.socket.bind(__p.settings.port, __p.settings.address);
    
    __p.running = true;
    __p.startTime = Date.now();
    
    return this;
  };
  
  /**
   * Stop ArcusNode
   *
   * @return {ArcusNode}
   */
  this.stop = function() {
    
    //Emit stop event
    this.emit('stop', this);
    
    clearInterval(__p.manageInterval);
    _manageCycle();
    
    //Close Connections
    for(k in __p.connections) {
      _closeConnection(__p.connections[k]);
    }
    
    if(__p.socket) {
      __p.socket.close();
    }
    __p.socket = null;
    __p.running = false;
    __p.startTime = 0;
    
    return this;
  };
  
};

//Inherit from EventEmitter
ArcusNode.prototype.__proto__ = EventEmitter.prototype;

/**
 * Access the groups in this instance
 * Remark: I don't like exposing this object to the public
 *         but maybe if there's no other simple way just make it as public attribute
 *
 * @return {Object}
 */
ArcusNode.prototype.__defineGetter__('groups', function(){
  return this.__p.groups;
});

/**
 * Access the connections in this instance
 *
 * @return {Object}
 */
ArcusNode.prototype.__defineGetter__('connections', function(){
  return this.__p.connections;
});

/**
 * Restart ArcusNode
 *
 * @return {ArcusNode}
 */
ArcusNode.prototype.restart = function(){
  if(this.__p.running){
    this.stop();
  }
  //TODO: use .listen(this.__p.settings.port)
  this.run();
  return this;
};

/**
 * @return {String} The current status of this ArcusNode
 */
ArcusNode.prototype.__defineGetter__('status', function(){
  return (this.__p.socket !== null) ? 'listening' : 'not running';
});

/**
 * @return {Boolean}
 */
ArcusNode.prototype.__defineGetter__('running', function(){
  return this.__p.running;
});

/**
 * Returns the number of seconds this instance is running,
 * and the number of seconds the process is running for
 *
 * @return {Array} [runTime, processUptime];
 */
ArcusNode.prototype.__defineGetter__('uptime', function(){
  return [(this.__p.startTime === 0) ? 0 : Math.floor((Date.now() - this.__p.startTime) * 0.001), process.uptime()];
});

/**
 * Get address ArcusNode is running on
 *
 * @return {object} Returns the sockets address
 */
ArcusNode.prototype.__defineGetter__('address', function(){
  return this.__p.socket.address();
});
  
/**
 * Load and use the given plugin.
 *
 * @param {String} name Additional arguments will be given to the plugin
 * @return {ArcusNode} for chaining
 */
ArcusNode.prototype.use = function(name) {
  var plugin = require('./plugins/' + name + '.js');
  this.plugins[name] = plugin;
  plugin.apply(null, [this].concat(Array.prototype.slice.call(arguments, 1)));
  return this;
};

/**
 * Returns the Logger instance that is used by ArcusNode
 */
ArcusNode.prototype.__defineGetter__('logger', function() {
  return this.__p.logger;
});
  
  
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

var util = require('util');
var events = require('events');
var dgram = require('dgram');
var Packet = require('./packet.js');
var RTMFP = require('./rtmfp.js');
var NetConnection = require('./net_connection.js');
var NetGroup = require('./net_group.js');
var ArcusEvent = require('./events.js');

module.exports = function(settings) {
  
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
  
   //Register Events (default listeners can be added here already)
  var _eventListeners = [];
  _eventListeners[ArcusEvent.HANDSHAKE] = [];
  _eventListeners[ArcusEvent.CONNECT] = [];
  _eventListeners[ArcusEvent.DISCONNECT] = [];
  _eventListeners[ArcusEvent.COMMAND] = []; 
  _eventListeners[ArcusEvent.ADDRESS] = []; 
  
  /** 
   * Adds a listener for an event type
   */
  this.addListener = function(type, listener, context) {
    if(typeof _eventListeners[type] === 'undefined') {
      throw new Error('No such event: ' + type);
    }
      
    _eventListeners[type].push({
      method: listener,
      context: context || this
    });
  }
  this.on = this.addListener;
  
  //Dispatch an Event with the given arguments
  var dispatchEvent = function(evt) {
    var type = evt.type();
    if(typeof _eventListeners[type] === 'undefined') {
      throw new Error('No such event to emit: ' + type);
    }
    
    if(_eventListeners[type].length == 0) {
      evt.finish();
      return;
    }
    
    var triggerCount = 0;
    var triggered = _eventListeners[type].length;
    for(var i = 0; i < triggered; i++) {
      (function(listener){
        process.nextTick(function() {
          listener.method.call(listener.context, evt);
          //Check if event was finished
          triggerCount++;
          if(triggerCount == triggered && !evt.finished()){
            evt.finish();
          }
        });
      })(_eventListeners[type][i]);
    }
    
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
    for(k in messages){
      var message = messages[k];
      message.remoteInfo = remoteInfo;
      
      //TODO: only really create packet when needed in this stage (before events)
      var responsePacket = new Packet(new Buffer(255), 0);
      
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
        case RTMFP.MESSAGE_TYPE.HANDSHAKE_1:
          
          _logger.debug('Handshake URL: ' + message.url);
          
          nc = new NetConnection(++_connectionCounter);
        
          //emit handshake event here
          var evt = new ArcusEvent(ArcusEvent.HANDSHAKE, _self, nc, message);
          evt.data = {
            url: message.url,
            remoteInfo: remoteInfo
          };
          dispatchEvent(evt);
          
          break;
                
        //
        // HANDSHAKE_2
        //
        case RTMFP.MESSAGE_TYPE.HANDSHAKE_2: {
          
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
        case RTMFP.MESSAGE_TYPE.NET_CONNECTION_OPEN:
          nc.state(NetConnection.CONNECTING);
            
          //remove cookie!
          delete _handshakeConnections[nc.cookie];
          delete nc.cookie;
          
          //emit connect event here
          var evt = new ArcusEvent(ArcusEvent.CONNECT, _self, nc, message);
          evt.data = message.commandData;
          dispatchEvent(evt);
          
          //Send ACK immediately
          _rtmfp.writePacket(responsePacket, { 
            type: RTMFP.MESSAGE_TYPE.ACK, 
            sentTime: message.sentTime,
            sequence: message.sequence,
            stage: message.stage
          });
          
          break;
        
        //
        // NET_CONNECTION_ADDRESSES
        //
        case RTMFP.MESSAGE_TYPE.NET_CONNECTION_ADDRESSES:
          
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
          
          //emit address event here
          dispatchEvent(new ArcusEvent(ArcusEvent.ADDRESS, _self, nc, message));
          
          //Send ACK immediately
          _rtmfp.writePacket(responsePacket, { 
            type: RTMFP.MESSAGE_TYPE.ACK, 
            sentTime: message.sentTime,
            sequence: message.sequence,
            stage: message.stage
          });
          
          break;
        
        //
        // COMMAND (RPC)
        //
        case RTMFP.MESSAGE_TYPE.COMMAND:
          //emit command event here
          var evt = new ArcusEvent(ArcusEvent.COMMAND, _self, nc, message);
          evt.command = message.commandName;
          evt.data = message.commandData;
          dispatchEvent(evt);
          
          //Send ACK immediately
          _rtmfp.writePacket(responsePacket, { 
            type: RTMFP.MESSAGE_TYPE.ACK, 
            sentTime: message.sentTime,
            sequence: message.sequence,
            stage: message.stage
          });
          
          break;
                  
        //
        // NET_CONNECTION_CLOSE
        //
        case RTMFP.MESSAGE_TYPE.NET_CONNECTION_CLOSE:
          if(nc.state() != NetConnection.CLOSING)
          {
            //emit disconnect event
            dispatchEvent(new ArcusEvent(ArcusEvent.DISCONNECT, _self, nc, message));
          }
          break;
        
        //
        // NET_GROUP_JOIN
        //
        case RTMFP.MESSAGE_TYPE.NET_GROUP_JOIN:
            
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
        case RTMFP.MESSAGE_TYPE.NET_GROUP_LEAVE:
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
        case RTMFP.MESSAGE_TYPE.RENDEZVOUZ:
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
            var newcomerMessage = { type: RTMFP.MESSAGE_TYPE.RENDEZVOUZ_2};
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
        case RTMFP.MESSAGE_TYPE.KEEPALIVE:
          _rtmfp.writePacket(responsePacket, message);
          break;
          
        //
        // KEEPALIVE_RESPONSE
        //
        case RTMFP.MESSAGE_TYPE.KEEPALIVE_RESPONSE:
          //Do nothing for now. If client replied on server keepalive, 
          //the connection was already touched at this point 
          break;
          
        //
        // ACK
        //
        case RTMFP.MESSAGE_TYPE.ACK:
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
        case RTMFP.MESSAGE_TYPE.NOT_ACK:
          //At the moment we just keep one last message, nack not really needed
          //TODO: Could increment nack counter on message to remove if reached X
          break;
        
        //
        // UNKNOWN_0x5e
        //
        case RTMFP.MESSAGE_TYPE.UNKNOWN_0x5e:
          _rtmfp.writePacket(responsePacket, message);
          break;
          
        default:
          _logger.error('Unhandled message: ' + pkt.toString());
          break;
        
      }
      
      //If availible, send the response 
      _sendResponse(message, nc, responsePacket, remoteInfo);
    }
  };
  
  /**
   * Encode, encrypt and send a response packet
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
      
      if(message.type != RTMFP.MESSAGE_TYPE.HANDSHAKE_1)
      {
        _rtmfp.encodePacket(responsePacket, nc.clientConnectionId);
      } else {
        _rtmfp.encodePacket(responsePacket, 0);
      }
      
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
   * finish incoming message and send response where needed with given data
   */
  this.finishMessage = function(message, nc) {
    var responsePacket = new Packet(new Buffer(255));
    var remoteInfo = message.remoteInfo;
    
    switch(message.type){
      //
      // HANDSHAKE_1
      //
      case RTMFP.MESSAGE_TYPE.HANDSHAKE_1:
          
        //Generate Cookie
        message.cookie = Packet.randomBytes(64);
        
        //Duplicate Cookie (otherwise it won't lookup later)
        nc.cookie = new Buffer(64);
        message.cookie.copy(nc.cookie, 0, 0, 64);
        
        _handshakeConnections[message.cookie] = nc;
        
        _rtmfp.writePacket(responsePacket, message);
        
        break;
      
      //
      // FORWARD
      //
      case RTMFP.MESSAGE_TYPE.FORWARD:
        
        _rtmfp.writePacket(responsePacket, message);
        
        break;
        
      //
      // NET_CONNECTION_OPEN
      //
      case RTMFP.MESSAGE_TYPE.NET_CONNECTION_OPEN:
        //Check if the NetConnection has been authenticated
        if(_settings.auth){
          if(!nc.authenticated()) {
            _closeConnection(nc);
            return;
          }
        }
        
        _rtmfp.writePacket(responsePacket, message);
        
        //Response has to be acknowledged
        nc.lastMessage(message);
        
        break;
      
      //
      // COMMAND (RPC)
      //
      case RTMFP.MESSAGE_TYPE.COMMAND:
      case RTMFP.MESSAGE_TYPE.COMMAND_RESULT:
      case RTMFP.MESSAGE_TYPE.COMMAND_ERROR:
        //send response with given data
        _rtmfp.writePacket(responsePacket, message);
        
        break;
        
      //
      // NET_CONNECTION_ADDRESSES
      //
      case RTMFP.MESSAGE_TYPE.NET_CONNECTION_ADDRESSES:
        
        _rtmfp.writePacket(responsePacket, message);
        
        if(nc.state() == NetConnection.CONNECTING)
        {
          nc.state(NetConnection.CONNECTED);
          
          //Map peer id to connection in server for rendevouz lookup
          _peerIdMap[nc.peerId()] = nc;
          
          //Response has to be acknowledged
          nc.lastMessage(message);
        }
        
        break;
        
      default:
        _logger.error('Unhandled finish message: ' + message);
        break;
      
    }
    
    _sendResponse(message, nc, responsePacket, remoteInfo);
  };
  
  /**
   * Finish an async event depending on its type
   */
  this.finishEvent = function(evt) {
    switch(evt.type()) {
      case ArcusEvent.HANDSHAKE:
        var message = evt.message();
        //allow forwarding with finish arguments
        if(evt.finishData.length > 0) {
          if(Array.isArray(evt.finishData[0])){
            message.type = RTMFP.MESSAGE_TYPE.FORWARD;
            message.addresses = evt.finishData[0];
          } else {
            throw new Error('To forward a handshake we need an array with at least one address object');
          }
        }
        this.finishMessage(message, evt.nc());
        break;
      case ArcusEvent.COMMAND:
        var message = evt.message();
        
        if(evt.finishData.length == 0) {
          //Let commands fail by default if there is no listener,
          //or event is not finished with a value
          message.type = RTMFP.MESSAGE_TYPE.COMMAND_ERROR;
          message.statusDescription = 'No command handler';
        } else if(evt.finishData[0] === false) {
          message.type = RTMFP.MESSAGE_TYPE.COMMAND_ERROR;
          
          //Add error description if given
          if(typeof evt.finishData[1] === 'string') {
            message.statusDescription = evt.finishData[1];
          }
        } else {
          message.type = RTMFP.MESSAGE_TYPE.COMMAND_RESULT;
          message.commandData = evt.finishData[0];
        }
        
        this.finishMessage(message, evt.nc());
        break;
      case ArcusEvent.CONNECT:
        this.finishMessage(evt.message(), evt.nc());
        break;
      case ArcusEvent.ADDRESS:
        this.finishMessage(evt.message(), evt.nc());
        break;
      case ArcusEvent.DISCONNECT: 
        _closeConnection(evt.nc());
        break;
      default:
        throw new Error('No finish action for event type "' + evt.type() + '"');
    }
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
   */
  var _sendClosePacket = function(nc) {
    if(nc.addresses.length > 0) {
      var pkt = new Packet(new Buffer(32));
      _rtmfp.writePacket(pkt, { type: RTMFP.MESSAGE_TYPE.NET_CONNECTION_CLOSE });
      _rtmfp.encryptPacket(pkt, nc.encryptKey);
      _rtmfp.encodePacket(pkt, nc.clientConnectionId);
      send(pkt, nc.addresses[0]);
    }
  };
  
  /**
   * Startup ArcusNode and listen for connections
   */
  this.run = function() {
    //Startup
    util.print('Starting up ArcusNode RTMFP Service.\nCopyright (C) 2011 OpenRTMFP \n' +
      'This program comes with ABSOLUTELY NO WARRANTY.\n' +
      'This is free software, and you are welcome to redistribute it under certain conditions.\n' +
      '(For usage help type "node service.js -h")\n');
  
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
    util.print('ArcusNode RTMFP Service running at ' + ((_settings.address != '') ? _settings.address + ':' : 'port ') + _settings.port);
  };
  
  /**
   * Stop ArcusNode
   */
  this.stop = function() {
    util.print('Stopping ArcusNode...');
    
    clearInterval(_manageInterval);
    _manageCycle();
    
    //Close Connections
    for(k in _connections) {
      _closeConnection(_connections[k]);
    }
    
    _socket.close();
    
    util.print('ArcusNode stopped.');
  };
  
};
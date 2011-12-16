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
var Map = require('./map.js');

/** 
 * The ArcusNode Server itself
 */
var ArcusNode = module.exports = function(settings) {
  
  var _self = this;
  
  /**
   * Private Attributes (most of them should not be messed with directly, unless you really know what you do)
   * Use corresponding Getters and Setters instead where available. Also they are not part of the public API and may change frequently later.
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
    rootConnections: true
  };
  
  //Merge Settings
  for(k in settings){
    __p.settings[k] = settings[k];
  }
  
  //TODO: Gather stats (Outside this with events maybe?)
    
  if(__p.settings.logger) {
    __p.logger = __p.settings.logger;
  } else {
    __p.logger = require('./logger.js').createLogger(__p.settings.logFile, __p.settings.logLevel);
  }
  
  __p.rtmfp = new RTMFP();
  __p.connections = new Map();
  __p.handshakeConnections = new Map();
  __p.connectionCounter = 0; //for temporary connection ids TODO: Replace with generated id
  __p.endpointConnections = new Map();
  __p.peerIdMap = new Map();
  __p.groups = new Map();
  __p.socket = null;
  __p.manageInterval = null;
  __p.commands = new Map();
  __p.running = false;
  __p.supportedProtocols = ['rtmfp:'];
  __p.startTime = 0;
  
  //Init __p.stats
  this.resetStats();
  
  //access plugins
  this.plugins = [];
  
  /**
   * The manage cycle checks for timeouts and does clean up
   */
  var _manageCycle = function(){
    try {
      var now = Date.now();
      
      //manage connections
      //- Resends last message if availible for connection
      //- Sends keepalive to client before timeout
      //- Drops timed out connections
      var deadConnections = [];
      
      __p.connections.forEach(function(id, nc)
      {
        if((now - nc.touched) > __p.settings.serverKeepalive && nc.__p.keepalives < __p.settings.maxKeepalives)
        {
          nc.keepalive();
        }
        else if((now - nc.touched) > __p.settings.connectionTimeout)
        {
          deadConnections.push(nc);
        }
        else if(nc.__p.lastMessage)
        {
          _resend(nc);
        }
      });
      
      //Drop dead connections
      for(var i = 0; i < deadConnections.length; i++)
      {
        //TODO: use NetConnection.timeout(); instead of just close
        deadConnections[i].close();
      }
      
      //cleanup handshake connections
      var deadHandshakes = [];
      __p.handshakeConnections.forEach(function(tag, nc)
      {
        //Handshake connections don't need to be hold longer than a few seconds for opening a connection
        //In 99.9% of cases there should be nothing to do here
        if((now - nc.touched) > __p.settings.connectionTimeout)
        {
          deadHandshakes.push(tag);
        }
      });
      
      //Drop dead handshake connections
      for(var i = 0; i < deadHandshakes.length; i++)
      {
        delete __p.handshakeConnections.remove(deadHandshakes[i]);
      }
      
      //manage groups
      var deadGroups = [];
      __p.groups.forEach(function(id, group)
      {
        if(group.size() == 0 && (now - group.touched()) > __p.settings.groupTimeout)
          deadGroups.push(group.id());
      });
      
      //Drop dead groups
      for(var i = 0; i < deadGroups.length; i++)
      {
        __p.groups.remove(deadGroups[i]);
      }
      
      //Gather stats
      __p.stats.droppedConnections += deadConnections.length;  
      __p.stats.droppedGroups += deadGroups.length;
      __p.stats.droppedHandshakes += deadHandshakes.length;  
      
      //Debug
      __p.logger.debug('MANAGE CYCLE TIME: ' + (Date.now() - now) + 'ms');
      __p.logger.debug('#Connections: ' + __p.connections.length + ' #dropped NCs: ' + deadConnections.length + ' #handshake NCs: ' + __p.handshakeConnections.length + ' #dropped hands. NCs: ' + deadHandshakes.length
        + ' #Groups: ' + __p.groups.length + ' #dropped groups: ' + deadGroups.length);
      
      //explicitly unset
      deadConnections = null;
      deadGroups = null;
      deadHandshakes = null;
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
    if(nc.endpoints.length > 0)
    {
      var resendPacket = new Packet(255);
      __p.rtmfp.writePacket(resendPacket, nc.__p.lastMessage);
      __p.rtmfp.encryptPacket(resendPacket, nc.__p.encryptKey);
      __p.rtmfp.encodePacket(resendPacket, nc.__p.clientConnectionId);
      _self.send(resendPacket, nc.endpoints[0]);
      nc.__p.lastMessage = null;
    }
  }
  
  /**
   * Handles a received packet and puts all the rtmfp protocol stuff into logic
   *
   * @param {Buffer} buffer The received data from the socket
   * @param {remoteInfo} remoteInfo The endpoint of the received data
   */
  var _packetHandler = function(buffer, remoteInfo){
    //Validate packet (min 20 bytes encrypted)
    if(buffer.length < 20){
      throw new Error('Packet too small');
    }
    
    var pkt = new Packet(buffer, buffer.length);
    var connectionId = __p.rtmfp.decodePacket(pkt);
    var nc = (__p.connections.get(connectionId)) ? __p.connections.get(connectionId) : null;
    
    if(nc && nc.state != NetConnection.CLOSING && !nc.waiting)
    {
      if(!__p.rtmfp.decryptPacket(pkt, nc.__p.decryptKey))
      {
        __p.logger.warn('Decryption Failed for nc', nc.id);
        return;
      }
      nc.touch();
      __p.logger.debug('Decrypted Packet from ', remoteInfo ,': \n' + pkt.toString());
    } 
    else if(!nc && connectionId == 0)
    {
      if(!__p.rtmfp.decryptPacket(pkt, RTMFP.SYMETRIC_KEY))
      {
        __p.logger.warn('Handshake Decryption Failed!');
        return;
      }
      __p.logger.debug('Decrypted Handshake Packet from ', remoteInfo ,': \n' + pkt.toString());
    } 
    else 
    {
      //Drop the Packet
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
      nc.__p.latency = message.latency;
    }
    
    //TODO: save last sentTime and timestamp with netconnection to decide if to send with echo time or not
    //nc.lastPacketTime = message.sentTime; nc.lastPacketReceived = Date.now();
    if(nc && message.sentTime){
      nc.__p.lastPacketTime = message.sentTime;
    }
    
    switch(message.type){
      //
      // HANDSHAKE_REQUEST
      //
      case RTMFP.HANDSHAKE_REQUEST:
        
        //validate protocol in handshake url
        var parsedUrl = URL.parse(message.url, false);
        if(__p.supportedProtocols.indexOf(parsedUrl.protocol.toLowerCase()) == -1){
          //Ignore handshake request for unsupported protocols
          __p.logger.error('Unsupported protocol request!', pkt.toString());
          return;
        }
        
        //TODO: Make NetConnection take arcus as only argument
        nc = new NetConnection(_self, ++__p.connectionCounter);
        //Add public address
        nc.endpoints.push({ address: remoteInfo.address, port: remoteInfo.port, public: true });
     
        //Generate Cookie
        message.cookie = Packet.randomBytes(64);
        
        //Duplicate Cookie (otherwise it won't lookup later)
        nc.cookie = new Buffer(64);
        message.cookie.copy(nc.cookie, 0, 0, 64);
        
        message.certificate = nc.certificate;
        
        __p.handshakeConnections.add(nc.cookie, nc);
        
        //emit handshake event here
        _self.emit('handshake', nc, parsedUrl, remoteInfo);
                
        //Create Response
        if(nc.state == NetConnection.HANDSHAKE){
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
        nc = __p.handshakeConnections.get(message.cookie);
        
        if(nc)
        {
          if(nc.state != NetConnection.HANDSHAKE)
            return;
          
          //the clientConnectionId is used to encode it to a response packet
          nc.__p.clientConnectionId = message.connectionId;
          
          //This will be used by the client to encode it to a packet so the server can lookup connections
          message.connectionId = nc.id;
          
          //Set the peer id for the connection
          nc.__p.peerId = message.peerId;
          
          //Do key exchange
          nc.computeSharedSecret(message.publicKey);
          message.publicKey = nc.publicKey;
          
          var serverNonce = __p.rtmfp.createServerNonce(nc.publicKey);
          nc.computeAsymetricKeys(message.clientCertificate, serverNonce);
           
          //Just add the connection to all connections here
          __p.connections.add(nc.id, nc);
          
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
        //State connecting here
        nc.state = NetConnection.CONNECTING;
        
        //Save the connection protocol message for late usage
        nc.__p.connectionMessage = message; 
       
        //Send ACK immediately
        _self.sendAck(nc, message);
                
        //remove cookie!
        __p.handshakeConnections.remove(nc.cookie);
        delete nc.cookie;
        
        //emit connect event here
        _self.emit.apply(_self, ['connect', nc].concat(message.commandData));
        
        if(nc.state == NetConnection.CONNECTING && !nc.waiting){
          nc.accept();
        }
                
        break;
      
      //
      // NET_CONNECTION_ADDRESSES
      //
      case RTMFP.NET_CONNECTION_ADDRESSES:
        
        //Reset endpoints
        if(nc.endpoints.length > 0)
        {
          __p.endpointConnections.remove(nc.endpoints[0]);
          nc.endpoints = [];
        }
        
        //Add public address
        nc.endpoints.push({ address: remoteInfo.address, port: remoteInfo.port, public: true });
        
        //Add private endpoints to nc
        nc.endpoints = nc.endpoints.concat(message.endpoints);
                    
        __p.endpointConnections.add(remoteInfo, nc);
        
        
        //emit address event here
        _self.emit('address', nc);
        
        if(nc.state == NetConnection.ACCEPTED)
        {
          //Map peer id to connection in server for rendevouz lookup
          __p.peerIdMap.add(nc.peerId, nc);
          
          //Response has to be acknowledged
          nc.__p.lastMessage = message;
        
          message.serverKeepalive = __p.settings.serverKeepalive;
          message.clientKeepalive = __p.settings.clientKeepalive;
          
          var responsePacket = new Packet(255);
          __p.rtmfp.writePacket(responsePacket, message);
          __p.rtmfp.writeAck(responsePacket, message.flow, message.stage, true);
          
          //At this point the connection is really connected
          nc.state = NetConnection.CONNECTED;
          
        }
        
        break;
      
      //
      // COMMAND (RPC)
      //
      case RTMFP.COMMAND:
        
        //Send ACK immediately
        _self.sendAck(nc, message);
        
        //TODO: route commands to app (if app is not given for NetConnection, invoke on _root)
        //Call registered command (if given) with arguments from AMF 
        //-> if command is not registered, return error message to client
        if(typeof __p.commands.get(message.commandName) === 'object') {
          //Call command callback async
          (function(handler, nc, message, arcus){
            process.nextTick(function() {
              var result = handler.method.apply(handler.context, [nc].concat(message.commandData));
              arcus.commandResult(nc, message, result);
            });
          })(__p.commands.get(message.commandName), nc, message, _self);
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
        if(nc.state != NetConnection.CLOSING)
        {
          //emit disconnect event
          _self.emit('disconnect', nc);
          nc.close();
        }
        break;
      
      //
      // MESSAGE_RESEND
      //
      case RTMFP.MESSAGE_RESEND:
        // TODO: investigate further, for now just acknowledge
        var responsePacket = new Packet(32);
        __p.rtmfp.writePacket(responsePacket, { 
          type: RTMFP.ACK, 
          sentTime: message.sentTime,
          flow: message.flow,
          stage: message.stage
        });
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
          nc.__p.lastMessage = message;
        }
        
        //Add connection to group
        group.add(nc);
        
        //Track group in connection
        nc.join(message.flow, group);
        
        //Unstable "duplex" header
        message.header[1][1] = 0x03;
        
        var responsePacket = new Packet(255);
        __p.rtmfp.writePacket(responsePacket, message);
        
        break;
      
      //
      // NET_GROUP_LEAVE
      //
      case RTMFP.NET_GROUP_LEAVE:
        //Leave group on connection with flow number
        var group = nc.leave(message.flow);
        
        if(group)
        {
          group.remove(nc.id);
        }
        
        var responsePacket = new Packet(255);
        __p.rtmfp.writePacket(responsePacket, message);
        
        break;
      
      //
      // RENDEZVOUZ_REQUEST
      //
      case RTMFP.RENDEZVOUZ_REQUEST:
        //Lookup requested peer
        var peerNc;
        for(var peerNum = 0; peerNum < message.peerIds.length; peerNum++){
          peerNc = __p.peerIdMap.get(message.peerIds[peerNum]);
          if(peerNc)
          {
            //TODO: check what FMS says on peer id not found
            
            //Send private parts of peer to requester
            message.endpoints = peerNc.endpoints;
            
            //Create response
            message.type = RTMFP.RENDEZVOUZ_RESPONSE;
            var requesterResponse = new Packet(255);
            __p.rtmfp.writePacket(requesterResponse, message);
            
            //Inform peer about newcomer
            var newcomerMessage = { type: RTMFP.RENDEZVOUZ_NEWCOMER};
            newcomerMessage.tag = message.tag;
            newcomerMessage.peerId = peerNc.peerId;
            
            //Question: If there is no NetConnection for the remote endpoint the message is coming from,
            //then the requester does not have a valid NetConnection to this server.
            //So the rendezvouz request would be invalid? Or do we allow rendezvouz without valid NetConnection?
            var requester = __p.endpointConnections.get(remoteInfo);
            newcomerMessage.pp = true;
            if(requester)
            {
              //We can iterate through private endpoints to tell the peer about
              //-> TODO: Check validity, makes always two steps if public endpoints are the same
              newcomerMessage.address = requester.nextAddress(newcomerMessage.tag);
              if(requester.endpoints[0].address == peerNc.endpoints[0].address)
              {
                newcomerMessage.address = requester.nextAddress(newcomerMessage.tag);
                newcomerMessage.pp = false;
              }
            } else {
              newcomerMessage.address = remoteInfo;
            }
            
            newcomerMessage.echoTime = peerNc.__p.lastPacketTime;
            
            if(peerNc.endpoints.length > 0 && newcomerMessage.address != undefined)
            {
              var directResponse = new Packet(255);
              __p.rtmfp.writePacket(directResponse, newcomerMessage);
              __p.logger.debug('Rendezvouz newcomer response: \n' + directResponse.toString());
              __p.rtmfp.encryptPacket(directResponse, peerNc.__p.encryptKey);
              __p.rtmfp.encodePacket(directResponse, peerNc.__p.clientConnectionId);
              _self.send(directResponse, peerNc.endpoints[0]);
            }
            
            __p.logger.debug('Rendezvouz requester response: ' + requesterResponse.toString());
            
            __p.rtmfp.encryptPacket(requesterResponse, RTMFP.SYMETRIC_KEY);
            __p.rtmfp.encodePacket(requesterResponse, 0);
            
            _self.send(requesterResponse, remoteInfo);
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
        //if last flow response in net_connection is acknowledged,
        //remove it so it doesn't get sent again
        
        if(nc.__p.lastMessage && nc.__p.lastMessage.flow == message.flow 
          && nc.__p.lastMessage.stage == message.stage)
        {
          nc.__p.lastMessage = null;
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
      _self.pack(nc, responsePacket);
      _self.send(responsePacket, (nc.endpoints.length > 0) ? nc.endpoints[0] : remoteInfo);
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
    this.__p.rtmfp.writePacket(responsePacket, message);
    this.pack(nc, responsePacket);
    this.send(responsePacket, nc.endpoints[0]);
  };
  
  /**
   * Register a command that can then be called by the client with NetConnection#call
   *
   * @param {string} name The name for the command that can be called by the client
   * @param {callback} callback A valid callback that will handle the command, its return value is sent to the client
   * @return {ArcusNode} for chaining
   */
  this.command = function(name, callback){
    
    __p.commands.add(name, _validCallback(callback));
    
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
        //TODO: call in arcus context
        _packetHandler(buffer, remoteInfo);
      } catch(e) {
        //TODO: handle error and recover
        __p.logger.error('Socket message handler error: ' + e.stack, Packet.prettyBuffer(buffer));
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
    __p.connections.forEach(function(id, nc){
      nc.close();
    });
    
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
 * Encode & encrypt a packet
 */
ArcusNode.prototype.pack = function(nc, packet){
  if(typeof nc === 'undefined' || packet.size() < 12)
  {
    throw new Error('Cannot pack packet.');
  }
  
  //Encrypt non handshake packets with the connections key
  if(nc.state != NetConnection.HANDSHAKE){
    this.__p.logger.debug('Normal Packet to ', nc.endpoints[0], ': \n' + packet.toString());
    this.__p.rtmfp.encryptPacket(packet, nc.__p.encryptKey);
  } else {
    this.__p.logger.debug('Handshake Packet to ', nc.endpoints[0], ': \n' + packet.toString());
    this.__p.rtmfp.encryptPacket(packet, RTMFP.SYMETRIC_KEY);
  }
  
  //Encode id to packet if nc.clientConnectionId given, will only be set afer HANDSHAKE_1
  this.__p.rtmfp.encodePacket(packet, nc.__p.clientConnectionId);
  
  return packet;
};
    
/**
 * Send a packet to a given remote endpoint
 *
 * @param {Packet} packet
 * @param {Endpoint} endpoint
 * @param {Function} callback
 */
ArcusNode.prototype.send = function(packet, endpoint, callback) {
  if(typeof endpoint === 'undefined'){
    throw new Error('Cannot send packet without endpoint');
  }
  var self = this;
  if(this.__p.running) {
    this.__p.socket.send(packet.buffer(), 0, packet.size(), endpoint.port, endpoint.address, function (err, bytes) {
        if (err) {
          self.__p.logger.error('Send: ', err.stack);
        }
        self.__p.logger.debug('Wrote ' + bytes + ' bytes to socket.');

        // Invoke Callback if given
        if(typeof callback === 'function'){
          callback(err, bytes);
        }
    });
  } 
};

/**
 * Sends an ack for the given message and connection
 *
 * @param {NetConnection} nc
 * @param {Object} message
 * @param {Function} callback Called when ack packet was actually sent
 */
ArcusNode.prototype.sendAck = function(nc, message, callback){
  var pkt = new Packet(32);
  this.__p.rtmfp.writePacket(pkt, { 
    type: RTMFP.ACK, 
    sentTime: message.sentTime,
    flow: message.flow,
    stage: message.stage
  });
  this.pack(nc, pkt);
  this.send(pkt, nc.endpoints[0], callback);
}

/**
 * Tell the client we accepted the netconnection
 * TODO: send as command answer
 */
ArcusNode.prototype.acceptConnection = function(nc, description){
  var message = nc.__p.connectionMessage;
  message.description = description;

  //TODO: handle as header with correct flow to follow (the flow on the client that initiated the connection)
  if(!Array.isArray(message.header)){
    message.header = [];
  }
  message.header.push(new Buffer('0a02', 'hex')); 

  message.type = RTMFP.NC_SUCCESS_RESPONSE
  var acceptPacket = new Packet(255);
  this.__p.rtmfp.writePacket(acceptPacket, message);
  this.__p.rtmfp.writeAck(acceptPacket, message.flow, message.stage, true);
  this.__p.rtmfp.encryptPacket(acceptPacket, nc.__p.encryptKey);
  this.__p.rtmfp.encodePacket(acceptPacket, nc.__p.clientConnectionId);
  this.send(acceptPacket, nc.endpoints[0]);
  
  //Response has to be acknowledged
  nc.__p.lastMessage = message;
};

/**
 * Tell the client we rejected the netconnection
 * TODO: send as command answer
 */
ArcusNode.prototype.rejectConnection = function(nc, description){
  var message = nc.__p.connectionMessage;
  message.description = description;

  //TODO: handle as header with correct flow to follow (the flow on the client that initiated the connection)
  if(!Array.isArray(message.header)){
    message.header = [];
  }
  message.header.push(new Buffer('0a02', 'hex')); 

  message.type = RTMFP.NC_REJECTED_RESPONSE
  var acceptPacket = new Packet(255);
  this.__p.rtmfp.writePacket(acceptPacket, message);
  this.__p.rtmfp.writeAck(acceptPacket, message.flow, message.stage, true);
  this.__p.rtmfp.encryptPacket(acceptPacket, nc.__p.encryptKey);
  this.__p.rtmfp.encodePacket(acceptPacket, nc.__p.clientConnectionId);
  this.send(acceptPacket, nc.endpoints[0]);
  
  //Response has to be acknowledged
  nc.__p.lastMessage = message;
};

/**
 * Tell the client the connection failed
 */
ArcusNode.prototype.failConnection = function(nc, flow){
  var message = {
    type: RTMFP.NC_FAILED_REQUEST,
    flow: flow
  };
  var failPacket = new Packet(255);
  this.__p.rtmfp.writePacket(failPacket, message);
  this.__p.rtmfp.encryptPacket(failPacket, nc.__p.encryptKey);
  this.__p.rtmfp.encodePacket(failPacket, nc.__p.clientConnectionId);
  this.send(failPacket, nc.endpoints[0]);
};


/**
 * Access the groups in this instance
 *
 * @return {Map}
 */
ArcusNode.prototype.__defineGetter__('groups', function(){
  return this.__p.groups;
});

/**
 * Access the connections in this instance
 *
 * @return {Map}
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

/**
 * Returns some statistics about this instance
 */
ArcusNode.prototype.__defineGetter__('stats', function() {
  return this.__p.stats;
});

/**
 * Reset the gathered stats
 * TODO: Gather failed connections
 *
 * @return {Object} stats 
 */
ArcusNode.prototype.resetStats = function(){
  return this.__p.stats = {
    droppedConnections: 0,
    droppedGroups: 0,
    droppedHandshakes: 0
  };
};
  
/**
 * Create an ArcusNode instance and return it
 */
ArcusNode.createServer = function(options) {
  return new ArcusNode(options);
};

/**
 * Close a client connection and do needed cleanup
 * This method will not trigger the close event on the connection,
 * so be sure you want that.
 *
 * @param {NetConnection} nc
 * @param {Function} callback when nc was actually closed
 * @return {ArcusNode} 
 */
ArcusNode.prototype.closeConnection = function(nc, callback){

  //Send close message to connection
  this.sendClosePacket(nc, (function(err, bytes){
    //Remove connection from peer id map
    this.__p.peerIdMap.remove(nc.peerId);
    
    //Remove connection from endpoint map
    if(nc.endpoints.length > 0) {
      this.__p.endpointConnections.remove(nc.endpoints[0]);
    }
    
    //Remove cookie if existent
    if(nc.cookie) {
      this.__p.handshakeConnections.remove(nc.cookie);
    }
    
    //Remove from connections
    this.__p.connections.remove(nc.id);

    if(typeof callback === 'function'){
      callback(err, bytes);
    }
  }).bind(this));          
  
  return this;
};

/**
 * Send a close message to the NetConnection 
 *
 * @param {NetConnection} nc The connection to close
 * @param {Function} callback
 */
ArcusNode.prototype.sendClosePacket = function(nc, callback) {
  if(nc.endpoints.length > 0) {
    var pkt = new Packet(32);
    this.__p.rtmfp.writePacket(pkt, { type: RTMFP.NET_CONNECTION_CLOSE });
    this.__p.rtmfp.encryptPacket(pkt, nc.__p.encryptKey);
    this.__p.rtmfp.encodePacket(pkt, nc.__p.clientConnectionId);
    this.send(pkt, nc.endpoints[0], callback);
  }
};

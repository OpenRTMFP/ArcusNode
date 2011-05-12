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

var events = require('events');
var console = require('console');
var dgram = require('dgram');
var Packet = require('./packet.js');
var RTMFP = require('./rtmfp.js');
var NetConnection = require('./net_connection.js');
var NetGroup = require('./net_group.js');

module.exports = function(settings) {
  
  var _settings = {
    manageInterval: 60000,
    port: 1935,
    address: '' //ArcusNode can be run on a specific interface if wanted
  };
  
  //Merge Settings
  for(k in settings)
    _settings[k] = settings[k];
    
  //TODO: implement log level && (console || file logging)
  if(_settings.console)
    console = _settings.console;
  
  //TODO: implement AUTH callback
  //TODO: Rename "Sequence" with "Flow"?
  
  var _rtmfp = new RTMFP();
  var _connections = {};
  var _handshakeConnections = {};
  var _connectionCounter = 0; //for temporary connection ids TODO: Replace with generated id
  var _endpointConnections = {};
  var _peerIdMap = {};
  var _groups = {};
  var _socket = null;
  
  /**
   * The manage cycle checks for timeouts and does clean up
   */
  var _manageCycle = function(){
    var now = new Date().getTime();
    //TODO: implement
  };
  
  /**
   * Handles a received packet and puts all the rtmfp protocol stuff into logic
   */
  var _messageHandler = function(buffer, remoteInfo){
    
    var pkt = new Packet(buffer, buffer.length);
    //TODO: Validate packet
    
    var connectionId = _rtmfp.decodePacket(pkt);
    
    var nc = (_connections[connectionId]) ? _connections[connectionId] : null;
    
    if(nc && nc.state() != NetConnection.CLOSING)
    {
      if(!_rtmfp.decryptPacket(pkt, nc.decryptKey))
      {
        console.warn('Decryption Failed!');
        return;
      }
      nc.touch();
      console.info('Decrypted Packet: \n' + pkt.toString());
    } 
    else if(!nc && connectionId == 0)
    {
      if(!_rtmfp.decryptPacket(pkt, RTMFP.SYMETRIC_KEY))
      {
        console.warn('Handshake Decryption Failed!');
        return;
      }
      console.info('Decrypted Handshake Packet: \n' + pkt.toString());
    } 
    else 
    {
      console.log('No known connection ' + connectionId + ' from: ' + remoteInfo.address + ':' + remoteInfo.port);
      return;
    }
    
    var requests = _rtmfp.getRequests(pkt);
    for(k in requests){
      var request = requests[k];
      var responsePacket = new Packet(new Buffer(255), 0);
      
      //Update latency of nc
      if(request.latency > 0)
      {
        nc.latency(request.latency);
      }
      
      console.log('Handling request type : ' + request.type);
      switch(request.type){
        //
        // HANDSHAKE_1
        //
        case RTMFP.REQUEST_TYPE.HANDSHAKE_1:
          
          nc = new NetConnection(++_connectionCounter);
            
          //Generate Cookie
          request.cookie = nc.cookie = Packet.randomBytes(64);
          _handshakeConnections[request.cookie] = nc;
          
          _rtmfp.setResponse(responsePacket, request);
          
          break;
                
        //
        // HANDSHAKE_2
        //
        case RTMFP.REQUEST_TYPE.HANDSHAKE_2: {
          
          //Lookup net_connection for cookie
          nc = _handshakeConnections[request.cookie];
          
          if(nc)
          {
            if(nc.state() != NetConnection.HANDSHAKE)
              return;
            
            //the clientConnectionId is used to encode it to a response packet
            nc.clientConnectionId = request.connectionId;
            
            //This will be used by the client to encode it to a packet so the server can lookup connections
            request.connectionId = nc.id();
            
            //Set the peer id for the connection
            nc.peerId(request.peerId);
            
            var keys = _rtmfp.computeAsymetricKeys(request.clientKey, request.clientCertificate);
            
            request.serverKey = keys[0];
            nc.decryptKey = keys[1];
            nc.encryptKey = keys[2];
            
            //Just add the connection to all connections here
            _connections[nc.id()] = nc;
              
            _rtmfp.setResponse(responsePacket, request);
              
          } else {
            console.warn('Handshake Cookie not found!');
          }
          
          break;
        }
        
        //
        // NET_CONNECTION_OPEN
        //
        case RTMFP.REQUEST_TYPE.NET_CONNECTION_OPEN:
          //TODO: Check AUTH here
          nc.state(NetConnection.CONNECTING);
            
          //remove cookie!
          delete _handshakeConnections[nc.cookie];
          delete nc.cookie;

          _rtmfp.setResponse(responsePacket, request);
          
          //Response has to be acknowledged
          nc.lastRequest(request);
          
          break;
        
        //
        // NET_CONNECTION_ADDRESSES
        //
        case RTMFP.REQUEST_TYPE.NET_CONNECTION_ADDRESSES:
          
          //Reset addresses
          if(nc.addresses.length > 0)
          {
            delete _endpointConnections[nc.addresses[0]];
            nc.addresses = [];
          }
          
          //Add public address
          nc.addresses.push(remoteInfo);
          
          //Add private addresses to nc
          nc.addresses = nc.addresses.concat(request.addresses);
                      
          _endpointConnections[remoteInfo] = nc;
    
          _rtmfp.setResponse(responsePacket, request);
          
          if(nc.state() == NetConnection.CONNECTING)
          {
            nc.state(NetConnection.CONNECTED);
            
            //Map peer id to connection in server for rendevouz lookup
            _peerIdMap[nc.peerId()] = nc;
            
            //Response has to be acknowledged
            nc.lastRequest(request);
          }
          
          break;
                
        //
        // NET_CONNECTION_CLOSE
        //
        case RTMFP.REQUEST_TYPE.NET_CONNECTION_CLOSE:
          if(nc.state() != NetConnection.CLOSING)
          {
            closeConnection(nc);
          }
          break;
        
        //
        // NET_GROUP_JOIN
        //
        case RTMFP.REQUEST_TYPE.NET_GROUP_JOIN:
            
          //Check if group exists, else create one
          var group = (_groups[request.groupId]) ? _groups[request.groupId] : _groups[request.groupId] = new NetGroup(request.groupId);
          
          if(group.size() > 0)
          {
            //Get fastest connections to send to client
            request.peers = group.fastest(nc);
            
            //Response has to be acknowledged
            nc.lastRequest(request);
          }
          
          //Add connection to group
          group.add(nc);
          
          //Track group in connection
          nc.join(request.sequence, group);
          
          _rtmfp.setResponse(responsePacket, request);
          
          break;
        
        //
        // NET_GROUP_LEAVE
        //
        case RTMFP.REQUEST_TYPE.NET_GROUP_LEAVE:
          //Leave group on connection with sequence number
          var group = nc.leave(request.sequence);
          
          if(group)
          {
            group.remove(nc.id());
          }
          
          _rtmfp.setResponse(responsePacket, request);
          
          break;
        
        //
        // RENDEZVOUZ
        //
        case RTMFP.REQUEST_TYPE.RENDEZVOUZ:
          //Lookup requested peer
          var peer = _peerIdMap[request.peerId];
            
          if(peer)
          {
            console.info('Found requested peer for rendezvouz');
            
            //Send private parts of peer to requester
            request.addresses = peer.addresses;
            
            var requesterResponse = new Packet(new Buffer(255), 0);
            _rtmfp.setResponse(requesterResponse, request);
            
            _rtmfp.encryptPacket(requesterResponse, RTMFP.SYMETRIC_KEY);
            _rtmfp.encodePacket(requesterResponse, 0);
            send(requesterResponse, remoteInfo);
            
            //Inform peer about newcomer
            var newcomerRequest = { type: RTMFP.REQUEST_TYPE.RENDEZVOUZ_2};
            newcomerRequest.tag = request.tag;
            newcomerRequest.peer = peer;
            
            //Question: If there is no NetConnection for the remote endpoint the request is coming from,
            //then the requester does not have a valid NetConnection to this server.
            //So the rendezvouz request would be invalid? Or do we allow rendezvouz without valid NetConnection?
            var requester = _endpointConnections[remoteInfo];
            if(requester)
            {
              //We can iterate through private addresses to tell the peer about
              newcomerRequest.address = requester.nextAddress(newcomerRequest.tag);
              if(requester.addresses[0].address == peer.addresses[0].address)
              {
                newcomerRequest.address = requester.nextAddress(newcomerRequest.tag);
              }
              newcomerRequest.peer = requester;
            } else {
              newcomerRequest.address = remoteInfo;
            }
            
            if(peer.addresses.length > 0)
            {
              var directResponse = new Packet(new Buffer(255), 0);
              _rtmfp.setResponse(directResponse, newcomerRequest);
              console.info('Rendezvouz newcomer response: \n%s', directResponse.toString());
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
        case RTMFP.REQUEST_TYPE.KEEPALIVE:
          _rtmfp.setResponse(responsePacket, request);
          break;
          
        //
        // KEEPALIVE_RESPONSE
        //
        case RTMFP.REQUEST_TYPE.KEEPALIVE_RESPONSE:
          //Do nothing for now. If client replied on server keepalive, 
          //the connection was already touched at this point 
          break;
          
        //
        // ACK
        //
        case RTMFP.REQUEST_TYPE.ACK:
          //if last sequence response in net_connection is acknowledged,
          //remove it so it doesn't get sent again
          
          if(nc.lastRequest() && nc.lastRequest().sequence == request.sequence 
            && nc.lastRequest().stage == request.stage)
          {
            nc.lastRequest(null);
          }
          
          //maybe keep requests in a list as request/NetConnection pairs,
          //and give the request a state and if acknowledged it is set to received
          //then it doesn't get sent again in the manage cycle,
          //to keep more than one request (unsure if needed to keep more than one request)
          
        //
        // NOT_ACK
        //
        case RTMFP.REQUEST_TYPE.NOT_ACK:
          //At the moment we just keep one last request, nack not really needed
          //TODO: Could increment nack counter on request to remove if reached X
          break;
        
        //
        // UNKNOWN_0x5e
        //
        case RTMFP.REQUEST_TYPE.UNKNOWN_0x5e:
          _rtmfp.setResponse(responsePacket, request);
          break;
          
        default:
          console.error('Unhandled request: %s', pkt.toString());
          break;
        
      }
      
      //If availible, send the response 
      if(nc && responsePacket.size() > 11)
      {
        if(nc.state() != NetConnection.HANDSHAKE){
          console.info('Normal Response to ' + remoteInfo.address + ':' + remoteInfo.port + ': \n' + responsePacket.toString());
          _rtmfp.encryptPacket(responsePacket, nc.encryptKey);
        } else {
          console.info('Handshake Response to ' + remoteInfo.address + ':' + remoteInfo.port + ': \n' + responsePacket.toString());
          _rtmfp.encryptPacket(responsePacket, RTMFP.SYMETRIC_KEY);
        }
        
        if(request.type != RTMFP.REQUEST_TYPE.HANDSHAKE_1)
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
        console.log('Wrote ' + bytes + ' bytes to socket.');
    });
  };
  
  /**
   * Close a client connection and do needed cleanup
   */
  var closeConnection = function(nc){
    //TODO: Implement
  };
   
  this.run = function() {
    //Startup
    console.log('Starting up ArcusNode RTMFP Service.\nCopyright (C) 2011 OpenRTMFP \n' +
      'This program comes with ABSOLUTELY NO WARRANTY.\n' +
      'This is free software, and you are welcome to redistribute it under certain conditions.');
  
    //Start manage cycle
    setInterval(_manageCycle, _settings.manageInterval);
    
    //Listen for connections
    //TODO: Support IPv6
    _socket = dgram.createSocket('udp4', function(buffer, remoteInfo){
      //Main Handler
      try {
        _messageHandler(buffer, remoteInfo);
      } catch(e) {
        //TODO: handle error and recover
        console.error('Message handler error: %s ', e.stack);
      }
    });
    _socket.bind(_settings.port, _settings.address);
    console.log('ArcusNode RTMFP Service running at ' + ((_settings.address != '') ? _settings.address + ':' : 'port ') + _settings.port);
  };
};
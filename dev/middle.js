/**
 * Middle
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
var dgram = require('dgram');
var URL = require('url');
var RTMFP = require('../lib/rtmfp.js');
var NetConnection = require('../lib/net_connection');
var Packet = require('../lib/packet.js');

var FMS = {};
var serverConnectionPort = Math.round(Math.random() * 45000) + 20000;
var serverConnection = new NetConnection(5);
var clientConnection = new NetConnection(10);

//Take arguments
process.argv.forEach(function (val, index, array) {
  if(index < 2)
    return;
  
  var valArr = val.split('=');
  switch(valArr[0]){
    case 'fms':
      FMS = URL.parse(valArr[1], false);
      console.log(FMS);
      if(!FMS.port){
        FMS.port = '1935';
      }
      FMS.address = FMS.hostname;
      break;
    default:
      util.print('\033[31mArgument unknown or malformed\033[0m: ' + val + '\nStopping process.');
      process.exit();
  }
});
//FMS = { address: '50.56.33.168', port: '10001', hostname: '50.56.33.168', pathname: '/9f562071a62ee15bc91c8eec-4b461ed21d0f'};

var rtmfp = new RTMFP();
var cpkt = null;

// Setup connection to FMS
var serverSocket = dgram.createSocket('udp4', function(buffer, remoteInfo){
  
  var pkt = new Packet(buffer, buffer.length);
  var id = rtmfp.decodePacket(pkt);
  
  if(id != 0 && serverConnection.state != NetConnection.HANDSHAKE){
    rtmfp.decryptPacket(pkt, serverConnection.__p.decryptKey);
  } else {
    rtmfp.decryptPacket(pkt, RTMFP.SYMETRIC_KEY);
  }
  
  try {
    var msgs = rtmfp.readPacket(pkt);
  } catch(e){
    console.log('RTMFP could not handle message from server.', e.stack);
    console.log('FMS to Client (unhandled): ', pkt.toString());
    rtmfp.encryptPacket(pkt, clientConnection.__p.encryptKey);
    rtmfp.encodePacket(pkt, clientConnection.__p.clientConnectionId);
    send(clientSocket, pkt, clientConnection.addresses[0]);
    return;
  }
  for(k in msgs){
    var msg = msgs[k];
    switch(msg.type){
      // FORWARD
      case RTMFP.FORWARD_REQUEST:
        for(k in msg.addresses){
          console.log('FORWARD ADDRESS: ', msg.addresses[k]);
        }
        break;
        
      // HANDSHAKE_RESPONSE
      case RTMFP.HANDSHAKE_RESPONSE:
        msg.type = RTMFP.KEY_REQUEST;
        
        msg.connectionId = serverConnection.id;
        msg.publicKey = serverConnection.publicKey;
        msg.certificate = serverConnection.certificate;
        
        var pkt = new Packet(new Buffer(200), 0).clear();
        rtmfp.writePacket(pkt, msg);
        rtmfp.encryptPacket(pkt, RTMFP.SYMETRIC_KEY);
        rtmfp.encodePacket(pkt, 0);
        send(serverSocket, pkt, FMS);
        break;
     
      // KEY_RESPONSE
      case RTMFP.KEY_RESPONSE:
        serverConnection.computeSharedSecret(msg.publicKey);
        
        var serverNonce = new Packet(msg.signature.length + msg.publicKey.length);
        serverNonce.writeBuffer(msg.signature);
        serverNonce.writeBuffer(msg.publicKey);
        serverConnection.computeAsymetricKeys(serverNonce.buffer(), rtmfp.createClientNonce(serverConnection.certificate));
        serverConnection.__p.state = NetConnection.CONNECTED;
        serverConnection.__p.clientConnectionId = msg.connectionId;
        
        console.log('Server connection established, ready to loop through.');
        break;
        
      // Send to client
      default:
        console.log('FMS to Client: ', pkt.toString());
        rtmfp.encryptPacket(pkt, clientConnection.__p.encryptKey);
        rtmfp.encodePacket(pkt, clientConnection.__p.clientConnectionId);
        send(clientSocket, pkt, clientConnection.addresses[0]);
        break;
    }
  }
  
});
serverSocket.bind(serverConnectionPort);

var send = function(socket, packet, endpoint) {
  socket.send(packet.buffer(), 0, packet.size(), endpoint.port, endpoint.address, function (err, bytes) {
    if (err) {
      //TODO: Handle error and recover
      throw err;
    }
  });
};

//
// Client Connections
//
var clientForwarder = dgram.createSocket('udp4', function(buffer, remoteInfo){
  
  var pkt = new Packet(buffer, buffer.length);
  var id = rtmfp.decodePacket(pkt);
  
  if(!rtmfp.decryptPacket(pkt, RTMFP.SYMETRIC_KEY)){
    console.log('Client initial message decryption failed');
    return;
  }
  console.log('Received Client Handshake:', pkt.toString());
  var msgs = rtmfp.readPacket(pkt);
  for(k in msgs){
    var message = msgs[k];
    
    switch(message.type){
      // HANDSHAKE_REQUEST
      case RTMFP.HANDSHAKE_REQUEST:
        var msg = { 
          type: RTMFP.FORWARD_REQUEST,
          endpoints: [ { address: '192.168.244.134', port: 20001 } ],
          tag: message.tag
        };
        var responsePacket = new Packet(128);
        rtmfp.writePacket(responsePacket, msg);
        console.log('Forwarding Client', responsePacket.toString());
        rtmfp.encryptPacket(responsePacket, RTMFP.SYMETRIC_KEY);
        rtmfp.encodePacket(responsePacket, 0);
        send(clientForwarder, responsePacket, remoteInfo);
        break;
    }
  }
});
clientForwarder.bind(1935);
var clientSocket = dgram.createSocket('udp4', function(buffer, remoteInfo){
  
  var pkt = new Packet(buffer, buffer.length);
  var id = rtmfp.decodePacket(pkt);
  var decrypted = false;
  
  if(id != 0 && clientConnection.state != NetConnection.HANDSHAKE){
    decrypted = rtmfp.decryptPacket(pkt, clientConnection.__p.decryptKey);
  } else {
    decrypted = rtmfp.decryptPacket(pkt, RTMFP.SYMETRIC_KEY);
  }
  if(!decrypted){
    console.log('Client message decryption failed');
    return;
  }
  
  try {
    var msgs = rtmfp.readPacket(pkt);
  } catch(e){
    console.log('RTMFP could not handle message from client.', e.stack);
    console.log('Client to FMS (unhandled): ', pkt.toString());
    rtmfp.encryptPacket(pkt, serverConnection.__p.encryptKey);
    rtmfp.encodePacket(pkt, serverConnection.__p.clientConnectionId);
    send(clientSocket, pkt, FMS);
    return;
  }
  
  for(k in msgs){
    var message = msgs[k];
    
    switch(message.type){
      // HANDSHAKE_REQUEST
      case RTMFP.HANDSHAKE_REQUEST:
        console.log('Received handler client handshake:', pkt.toString());
        //Generate Cookie
        message.cookie = Packet.randomBytes(64);
        message.certificate = clientConnection.certificate;

        //Create Response
        if(clientConnection.state == NetConnection.HANDSHAKE){
          message.type = RTMFP.HANDSHAKE_RESPONSE;
          var responsePacket = new Packet(255);
          rtmfp.writePacket(responsePacket, message);
          rtmfp.encryptPacket(responsePacket, RTMFP.SYMETRIC_KEY);
          rtmfp.encodePacket(responsePacket, 0);
          send(clientSocket, responsePacket, remoteInfo);
        }
        
        break;
              
      // KEY_REQUEST
      case RTMFP.KEY_REQUEST:
        if(clientConnection.state != NetConnection.HANDSHAKE)
          return;
        clientConnection.__p.state = NetConnection.CONNECTED;
        
        //the clientConnectionId is used to encode it to a response packet
        clientConnection.__p.clientConnectionId = message.connectionId;
        console.log('Client Connection Id', message.connectionId);
        
        //This will be used by the client to encode it to a packet so the server can lookup connections
        message.connectionId = clientConnection.id;
        
        clientConnection.addresses.push(remoteInfo);

        //Do key exchange
        clientConnection.computeSharedSecret(message.publicKey);
        message.publicKey = clientConnection.publicKey;
        
        var serverNonce = rtmfp.createServerNonce(clientConnection.publicKey);
        clientConnection.computeAsymetricKeys(message.clientCertificate, serverNonce);
        
        message.type = RTMFP.KEY_RESPONSE
        var responsePacket = new Packet(255);
        rtmfp.writePacket(responsePacket, message);
        rtmfp.encryptPacket(responsePacket, RTMFP.SYMETRIC_KEY);
        rtmfp.encodePacket(responsePacket, clientConnection.__p.clientConnectionId);
        send(clientSocket, responsePacket, clientConnection.addresses[0]);
        
        console.log('Client connection established, ready to loop through.');
        break;
      
      // NET_CONNECTION_REQUEST
      case RTMFP.NET_CONNECTION_REQUEST:
        console.log('Client to FMS (connect original): ', pkt.toString());
        message.url = 'rtmfp://' + FMS.hostname + ((FMS.pathname) ? FMS.pathname : '');
        message.app = ((FMS.pathname) ? FMS.pathname : '').substr(1);
        pkt = new Packet(300);
        rtmfp.writePacket(pkt, message);
        // >>
        
      // Send to server
      default:
        console.log('Client to FMS: ', pkt.toString());
        rtmfp.encryptPacket(pkt, serverConnection.__p.encryptKey);
        rtmfp.encodePacket(pkt, serverConnection.__p.clientConnectionId);
        send(serverSocket, pkt, FMS);
        break;
    }
  }
});
clientSocket.bind(20001);

//
// Init connection to FMS
//
var message = {};
message.type = RTMFP.HANDSHAKE_REQUEST;
message.url = 'rtmfp://' + FMS.hostname + ((FMS.pathname) ? FMS.pathname : '');
message.tag = Packet.randomBytes(16, new Buffer(16), 0);

var pkt = new Packet(64);

rtmfp.writePacket(pkt, message);
console.log(pkt.toString());
rtmfp.encryptPacket(pkt, RTMFP.SYMETRIC_KEY);
rtmfp.encodePacket(pkt, 0);
send(serverSocket, pkt, FMS);

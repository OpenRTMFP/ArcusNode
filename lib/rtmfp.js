/**
 * RTMFP - The Protocol
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
 * This file is a part of ArcusNode.
 */

var net = require('net');
var Packet = require('./packet.js');
var AMF = require('./amf.js');
var AMF0 = require('./amf0.js');
var rtmfp = require('../build/default/rtmfp.node');

//Packet Markers
var RTMFP_MARKER_HANDSHAKE = 0x0b,
RTMFP_MARKER_MESSAGE_1 = 0x0d,
RTMFP_MARKER_MESSAGE_2 = 0x8d,
RTMFP_MARKER_MESSAGE_3 = 0x89,
RTMFP_MARKER_MESSAGE_4 = 0x09,
RTMFP_MARKER_RESPONSE_1 = 0x4e,
RTMFP_MARKER_RESPONSE_2 = 0x4a,
RTMFP_VALID_MARKERS = [0x8d, 0x8e, 0x8a, 0x0d, 0x0b, 0x89, 0x09, 0x49, 0x4e, 0x4a, 0x0e];
RTMFP_VALID_MESSAGES = [0x10, 0x11, 0x30, 0x38, 0x51, 0x01, 0x41, 0x0c, 0x4c, 0x18, 0x71, 0x70, 0x78, 0x5e];

/**
 * RTMFP
 * TODO: handle connect and address message as command
 * TODO: the deltaNack in a command is an index for a command flow
 */
var RTMFP = module.exports = function(){
  
  var _rtmfp = new rtmfp.RTMFP();
  
  var _epoch = (function(){
    var d = new Date();
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
  })();
  
  /**
   * Read RTMFP Messages from a packet and return message objects in an array
   */
  this.readPacket = function(pkt){
    messages = [];
    pkt.pos(6);
    
    var marker = pkt.readInt8();
    
    if (RTMFP_VALID_MARKERS.indexOf(marker) == -1){
      throw new Error('Invalid packet marker ' + marker);
    }
    
    var time1 = pkt.readInt16();
    var time2 = 0;
    
    var message = null;
    
    //with echo time
    if ((marker | 0xF0) == 0xFD || marker == 0x4e || marker == 0x0e) {
      time2 = pkt.readInt16();
    }
    
    while(pkt.available() > 0 && RTMFP_VALID_MESSAGES.indexOf(pkt.peek()) != -1)
    {
      message = this.readMessage(pkt, message);
      if(message)
      {
        var now = _timeNow();
        message.receivedTime = now;
        message.sentTime = time1;
        message.echoTime = time2;
        if(time2 > 0)
          message.latency = now - time2;
        messages.push(message);
      }
    }
    return messages;
  };
  
  /**
   * Read a single message from a packet
   */
  this.readMessage = function(pkt, lastMessage){
    var type = pkt.readInt8();
        
    //Ensure packet bytes
    if(pkt.available() < 2)
      return null;
      
    var messageSize = pkt.readInt16();
    
    //Ensure packet bytes
    if(pkt.available() < messageSize){
      return null;
    }
    
    //Clip packet to size
    var clippedPkt = new Packet(pkt.readBytes(messageSize), messageSize);
    var message = null;
    
    switch(type)
    {
      //
      // FORWARD_REQUEST
      //
      case 0x71:
        message = { type: RTMFP.FORWARD_REQUEST };
        
        message.tag = clippedPkt.readBytes(clippedPkt.readInt8(), true);
        message.addresses = [];
        
        //TODO: read IPv6 also
        while(clippedPkt.available() > 0 && clippedPkt.readInt8() == 1) {
          message.addresses.push(this.readRawIpv4(clippedPkt));
        }
        break;      
      
      //
      // Message: HANDSHAKE_REQUEST / RENDEZVOUZ_REQUEST
      //
      case 0x30:
        var msgLength;
        
        //Two times the message length
        clippedPkt.readU29();
        msgLength = clippedPkt.readU29();
        
        var handshakeType = clippedPkt.readInt8();
        
        //Rendevouz
        if(handshakeType == 0x0f)
        {
          if(clippedPkt.available() > 32){
            message = { type: RTMFP.RENDEZVOUZ_REQUEST };
            message.peerIds = [clippedPkt.readBytes(32, true)];
            //Read more than one peer id
            while(clippedPkt.available() > 36 && clippedPkt.peek() == 0x11){
              clippedPkt.skip(1);
              if(clippedPkt.readInt16() == 34 && clippedPkt.readInt16() == 11){
                message.peerIds.push(clippedPkt.readBytes(32, true));
              } else {
                throw new Error('Tried to read more than one peer id for rendezvouz but failed. ' + pkt.toString());
              }
            }
          }
        }
        else if(handshakeType == 0x0a)
        {
          if(clippedPkt.available() >= msgLength - 1){
            message = { type: RTMFP.HANDSHAKE_REQUEST };
            //URL connected to
            message.url = clippedPkt.readBytes(msgLength - 1).toString('ascii');
          }
        }
        
        if(message != null && clippedPkt.available() >= 16){
          message.tag = clippedPkt.readBytes(16, true);
        } else {
          message = null;
        }
        
        if(message == null){
          throw new Error('Tried to read malicious handshake packet: ' + pkt.toString());
        }
                  
        break;
      
      //
      // HANDSHAKE_RESPONSE
      //
      case 0x70:
        message = { type: RTMFP.HANDSHAKE_RESPONSE };
        
        message.tag = clippedPkt.readBytes(clippedPkt.readInt8(), true);
        message.cookie = clippedPkt.readBytes(clippedPkt.readInt8());
        message.certificate = clippedPkt.readBytes(clippedPkt.size() - clippedPkt.pos());
        
        break;
      
      //
      // KEY_RESPONSE
      //
      case 0x78:
        message = { type: RTMFP.KEY_RESPONSE };
        
        message.connectionId = clippedPkt.readInt32();
        
        clippedPkt.skip(1);
        message.signature = clippedPkt.readBytes(clippedPkt.readInt8());
        message.publicKey = clippedPkt.readBytes(clippedPkt.size() - clippedPkt.pos() - 1);
        
        break;
        
      //
      // Message: KEY_REQUEST
      //
      case 0x38:
        message = { type: RTMFP.KEY_REQUEST };
        message.connectionId = clippedPkt.readInt32();
        var cookie_size = clippedPkt.readInt8();
        if(cookie_size != 64)
        {
          throw new Error('COOKIE SIZE != 64');
        }
        message.cookie = clippedPkt.readBytes(cookie_size);
        
        var keySize = clippedPkt.readU29();
        
        var pos = clippedPkt.pos();
        
        message.clientSignature = clippedPkt.readBytes(4);
        message.publicKey = clippedPkt.readBytes(keySize - 4);
        
        clippedPkt.pos(pos);
        var keyPlusSig = clippedPkt.readBytes(keySize);
        
        var certificate_size = clippedPkt.readInt8();
        if(certificate_size != 76)
        {
          throw new Error('handshake client certificate size exceeded!');
        }
        
        message.clientCertificate = clippedPkt.readBytes(certificate_size);
        
        //Compute the client peer id
        if(!keyPlusSig || keySize == 0){
          throw new Error('Cannot compute peer id without correct arguments');
        }
        message.peerId = _rtmfp.computePeerId(keyPlusSig, keySize);
        
        break;
     
      
      //
      // Message: KEEPALIVE_REQUEST
      //
      case 0x01:
        message = { type: RTMFP.KEEPALIVE_REQUEST };
        break;
      
      //
      // Message: KEEPALIVE_RESPONSE
      //
      case 0x41 :
        message = { type: RTMFP.KEEPALIVE_RESPONSE };
        break;
      
      //
      // Message: NET_CONNECTION_CLOSE
      //
      case 0x0c:
      case 0x4c:
        message = { type: RTMFP.NET_CONNECTION_CLOSE };
        break;
            
      //
      // Message: ACK and NACK
      //
      case 0x51:
        var flow = clippedPkt.readInt8();
        var ackMarker = clippedPkt.readInt8();
        if(ackMarker == 0xFF) //happens after response is resend many times...
        {
          ackMarker = clippedPkt.readInt8();
        }
        message = { type: (ackMarker == 0x7f) ? RTMFP.ACK : RTMFP.NOT_ACK };
        message.flow = flow;
        message.stage = clippedPkt.readInt8();
        break;
      
      //
      // Message: NC_FAILED_REQUEST
      // raises "NetConnection.Connect.Failed" on client
      //
      case 0x5e:
        message = { type: RTMFP.NC_FAILED_REQUEST };
        message.flow = clippedPkt.readInt8();
        break;
      
      //
      // Message: UNKNOWN
      //
      case 0x18: 
        throw new Error('UNHANDLED MESSAGE TYPE 0x18');
        break;
      
      //
      // Message: FLOW (RPC || GROUP)
      // TODO: handle 91 2E F8 CE 3B 05 09 E2 B6 10 00 04 03 03 02 01 
      // -> Read correct headers:
      // MESSAGE_HEADER 0x80
      // MESSAGE_WITH_AFTERPART 0x10
      // MESSAGE_WITH_BEFOREPART 0x20
      // MESSAGE_ABANDONMENT 0x02
      // MESSAGE_END 0x01
      //
      case 0x10 : 
      case 0x11 :
        message = {};
        message.flag = clippedPkt.readInt8(); // 0x80 extended header, 0x00 non extended header
        
        //Sometimes 11 00 01 03 is appended to Group Join, don't know why...
        //TODO: should be fixed with correct header reading: MESSAGE_ABANDONMENT 0x02 && MESSAGE_END 0x01
        if(messageSize == 1 || clippedPkt.available() < 3) {
          return null;
        }
        
        if(type == 0x11 && lastMessage != null) {
          message.flow = lastMessage.flow;
          message.stage = lastMessage.stage;
          message.delta = lastMessage.delta;
          if(lastMessage.signature) {
            message.signature = lastMessage.signature;
          }
        } else {
          message.flow = clippedPkt.readInt8();
          message.stage = clippedPkt.readInt8();
          message.delta = clippedPkt.readInt8();
        }
        
        if(message.flag == 0x80 || message.flag == 0x83) {
          message.signature = clippedPkt.readBytes(clippedPkt.readInt8(), true);
        }

        //Flag 0x03 is connect failed answer/retry without header (when connection request was acknowledged)
        //Flag 0x83 is connect failed answer/retry WITH header/signature (if connection request was NOT acknowledged
        if(message.flag == 0x83 || message.flag == 0x03){
          return message;
        }
        
        if(message.flow == 0x02)
        {
          //TODO: investigate
          message.unknown2 = clippedPkt.readBytes(6);
          console.log('UNKNOWN PART: ', message.unknown2);
          
          message.commandName = AMF0.readString(clippedPkt);
          message.commandHandle = AMF0.readNumber(clippedPkt);
          
          switch(message.commandName) {
            //Handle NetConnection 
            case 'connect':
              message.type = RTMFP.NET_CONNECTION_REQUEST;
              //Read AMF Data
              //TODO: only read AMF data if null marker
              message.commandData = AMF.readAMF0(clippedPkt);
              break;
            
            //Handle Addresses for NetConnection
            //TODO: handle as command outside
            case 'setPeerInfo':
              message.type = RTMFP.NET_CONNECTION_ADDRESSES;
              
              clippedPkt.skip(1);
              
              message.addresses = [];
              while(clippedPkt.available() > 3 && clippedPkt.readInt8() == 0x02)
              {
                message.addresses.push(this.readAddress(clippedPkt));
              }
              
              break;
              
            //read command object and return it with message
            default:
              //Read AMF Data
              message.type = RTMFP.COMMAND;
              //TODO: only read AMF data if null marker
              message.commandData = AMF.readAMF0(clippedPkt);
              break;
          }
          
        }
        
        //NetGroup stage 1
        else if(message.flow > 0x02 && message.stage == 0x01)
        {
          message.type = RTMFP.NET_GROUP_JOIN;
          message.unknown1 = clippedPkt.readBytes(2); //Unknown data
          clippedPkt.skip(3);
          message.groupId = clippedPkt.readBytes(clippedPkt.readU29(), true);
        }
        
        //NetGroup stage 2
        else if(message.flow > 0x02 && message.stage == 0x02)
        {
          message.type = RTMFP.NET_GROUP_LEAVE;
        }
        
        break;
      
      default:
        throw new Error('Unhandled Message: ', pkt.toString());
        break;
    }
    
    return message;
  };
  
  /**
   * Writes a message to a packet
   * TODO: rename to writeMessage() ???
   */
  this.writePacket = function(pkt, message){
    pkt.pos(6);
    
    switch(message.type)
    {
      //
      // HANDSHAKE_RESPONSE
      //
      case RTMFP.HANDSHAKE_RESPONSE:
        pkt.writeInt8(RTMFP_MARKER_HANDSHAKE);
        pkt.writeInt16(_timeNow());
        pkt.writeInt8(0x70);
        pkt.writeInt16(16 + message.cookie.length + 77 + 2);
        
        pkt.writeInt8(16);
        pkt.writeBuffer(message.tag);
        
        pkt.writeInt8(message.cookie.length);
        pkt.writeBuffer(message.cookie);
        
        pkt.writeBytes([0x01,0x0A,0x41,0x0E])
        if(message.certificate.length != 64){
          throw new Error('Incorrect certificate for handshake response');
        }
        pkt.writeBuffer(message.certificate);
        pkt.writeBytes([0x02,0x15,0x02,0x02,0x15,0x05,0x02,0x15,0x0E])
        
        break;
      
      //
      // HANDSHAKE_REQUEST
      //
      case RTMFP.HANDSHAKE_REQUEST:
        pkt.writeInt8(RTMFP_MARKER_HANDSHAKE);
        pkt.writeInt16(_timeNow());
        pkt.writeInt8(0x30);
        pkt.writeInt16(message.tag.length + message.url.length + 3);
        
        //write url size
        pkt.writeU29(message.url.length + 2);
        pkt.writeU29(message.url.length + 1);
        
        pkt.writeInt8(0x0a);
        
        pkt.writeString(message.url);
        pkt.writeBuffer(message.tag);
                
        break;
            
      //
      // FORWARD_REQUEST
      //
      case RTMFP.FORWARD_REQUEST:
        pkt.writeInt8(RTMFP_MARKER_HANDSHAKE);
        pkt.writeInt16(_timeNow());
        pkt.writeInt8(0x71);
        
        var sizePos = pkt.pos();
        pkt.skip(2); //size placeholder
        
        pkt.writeInt8(16);
        if(!message.tag){
          throw new Error('Need a tag from handshake to write forward request');
        }
        pkt.writeBuffer(message.tag);
        
        for(var i = 0; i < message.endpoints.length; i++) {
          this.writeAddress(pkt, message.endpoints[i], false);
        }
        
        //write size finally
        writeSize(pkt, sizePos, pkt.size() - sizePos - 2);
                
        break;
        
      //
      // KEY_RESPONSE
      //
      case RTMFP.KEY_RESPONSE:
        pkt.writeInt8(RTMFP_MARKER_HANDSHAKE);
        pkt.writeInt16(_timeNow());
        pkt.writeInt8(0x78);
        var nonce = this.createServerNonce(message.publicKey);
        pkt.writeInt16(nonce.length + 7);
        
        pkt.writeInt32(message.connectionId);
        
        pkt.writeU29(nonce.length);
        pkt.writeBuffer(nonce);
        
        pkt.writeInt8(0x58);
        
        break;
      
      //
      // KEY_REQUEST
      //
      case RTMFP.KEY_REQUEST:
        pkt.writeInt8(RTMFP_MARKER_HANDSHAKE);
        pkt.writeInt16(_timeNow());
        pkt.writeInt8(0x38);
        
        var sizePos = pkt.pos();
        pkt.skip(2); //size placeholder
        
        pkt.writeInt32(message.connectionId);
        pkt.writeInt8(message.cookie.length);
        pkt.writeBuffer(message.cookie);
        
        //TODO: write real keysize and signature
        pkt.writeBytes([0x81, 0x04, 0x81, 0x02, 0x1d, 0x02]);
        
        pkt.writeBuffer(message.publicKey);
        
        var nonce = this.createClientNonce(message.certificate);
        pkt.writeU29(nonce.length);
        pkt.writeBuffer(nonce);
        
        pkt.writeInt8(0x58);
        
        //write size finally
        writeSize(pkt, sizePos, pkt.size() - sizePos - 2);
        
        break;
      //
      // NET_CONNECTION_REQUEST
      //
      case RTMFP.NET_CONNECTION_REQUEST:
        
        if(!message.echoTime){
          pkt.writeInt8(RTMFP_MARKER_MESSAGE_3);
          pkt.writeInt16(_timeNow());
        } else {
          pkt.writeInt8(RTMFP_MARKER_MESSAGE_2);
          pkt.writeInt16(_timeNow());
          pkt.writeInt16(message.echoTime);
        }
        pkt.writeInt8(0x10);
        
        var sizePos = pkt.pos();
        pkt.skip(2); //size placeholder
        
        pkt.writeInt8(0x80); //header flag
        pkt.writeBytes([0x02, 0x01, 0x01]); //hardcoded for testing flow, stage, command index
        pkt.writeBytes([0x05, 0x00, 0x54, 0x43, 0x04, 0x00, 0x00, 0x14, 0x00, 0x00, 0x00, 0x01]); //hardcoded header
        
        AMF0.writeString(pkt, 'connect'); //commandName
        AMF0.writeNumber(pkt, 1); //commandHandle
        
        AMF0.writeObject(pkt, {
          app: message.app, //rtmfp://127.0.0.1/test <- app/devkey
          objectEncoding: 3,
          swfUrl: undefined,
          pageUrl: undefined,
          tcUrl: message.url,
          flashVer: 'WIN 10,2,159,1',
          fpad: false,
          capabilities: 235,
          audioCodecs: 3191,
          videoCodecs: 252,
          videoFunction: 1
        });
        
        //write size finally
        writeSize(pkt, sizePos, pkt.size() - sizePos - 2);
        
        break;
      //
      // NET_CONNECTION_RESPONSE
      // TODO: add and handle NET_CONNECTION_FAILED & NET_CONNECTION_SUCCESS
      //
      case RTMFP.NET_CONNECTION_RESPONSE:
        //Todo: check if response was sent multiple times and after
        //30 sec send response without echo time (message.sentTime and message.echoTime)
        
        //TODO: No echo time if latency > 30 sec
        pkt.writeInt8(RTMFP_MARKER_RESPONSE_1); //response with echo time
        pkt.writeInt16(_timeNow());
        pkt.writeInt16(message.sentTime);
                
        // Prepare response
        pkt.writeInt8(0x10);
        
        var sizePos = pkt.pos();
        pkt.skip(2); //size placeholder
        
        pkt.writeInt8(message.flag);
        pkt.writeInt8(message.flow);
        pkt.writeInt8(message.stage);
        pkt.writeInt8(0x01); // 0x01 flag to ack previus command
        
        //Echo message signature
        //only echo if flag says so
        if(message.flag == 0x80 || message.flag == 0x83) {
          pkt.writeInt8(message.signature.length);
          pkt.writeBuffer(message.signature);
        }
        
        //TODO: handle as header with correct flow to follow (the flow on the client that initiated the connection)
        pkt.writeBytes([0x02, 0x0a, 0x02]); 
        //Echo yet unknown part from message
        pkt.writeBuffer(message.unknown2);
        
        AMF0.writeString(pkt, '_result');
        AMF0.writeNumber(pkt, message.commandHandle);
        AMF0.writeNull(pkt);
        
        //Write success status object
        AMF0.writeObject(pkt, {
          objectEncoding: 3, //We only can take 3 for rtmfp, otherwise flash fails connection
          description: 'Connection succeeded',
          level: 'status',
          code: 'NetConnection.Connect.Success'
        });
                        
        //write size finally
        writeSize(pkt, sizePos, pkt.size() - sizePos - 2);
        
        break;
      
      //
      // Response: COMMAND_RESULT
      // Response: COMMAND_ERROR
      //
      case RTMFP.COMMAND_RESULT:
      case RTMFP.COMMAND_ERROR:
        //TODO: No echo time if latency > 30 sec
        pkt.writeInt8(RTMFP_MARKER_RESPONSE_1); //response with echo time
        pkt.writeInt16(_timeNow());
        pkt.writeInt16(message.sentTime);
                
        // Prepare response
        pkt.writeInt8(0x10);
        
        var sizePos = pkt.pos();
        pkt.skip(2); //size placeholder
        
        pkt.writeInt8(message.flag);
        pkt.writeInt8(message.flow);
        pkt.writeInt8(message.stage);
        pkt.writeInt8(0x01); // 0x01 flag to ack previous command
        
        pkt.writeInt8(0x14);
        pkt.writeInt32(0x00);
        
        AMF0.writeString(pkt, (message.type === RTMFP.COMMAND_RESULT) ? '_result' : '_error');
        AMF0.writeNumber(pkt, message.commandHandle);
        
        //AMF0 NULL MARKER to close header
        AMF0.writeNull(pkt);
                    
        if(message.type === RTMFP.COMMAND_RESULT) {
          
          //write response AMF
          if(typeof message.commandData !== 'undefined'){
            AMF0.writeValue(pkt, message.commandData);
          }
          
        } else if(message.type === RTMFP.COMMAND_ERROR) {
          
          var statusObject = {
            level: 'error',
            code: 'NetConnection.Call.Failed'
          };

          if(typeof message.statusDescription === 'string') {
            statusObject.description = message.statusDescription;
          }
          
          //write response AMF
          AMF0.writeObject(pkt, statusObject);
        
        }
                  
        //write size finally
        writeSize(pkt, sizePos, pkt.size() - sizePos - 2);
        
        break;
            
      //
      // Response: NET_CONNECTION_ADDRESSES
      //
      case RTMFP.NET_CONNECTION_ADDRESSES:
        //TODO: No echo time if latency > 30 sec
        pkt.writeInt8(RTMFP_MARKER_RESPONSE_1); //response with echo time
        pkt.writeInt16(_timeNow());
        pkt.writeInt16(message.sentTime);
        
        if(message.stage == 0x02)
        {
          pkt.writeInt8(0x10);
          pkt.writeInt16(0x13);
          pkt.writeBytes([0x00, 0x02, 0x02, 0x01, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x29]);
          pkt.writeInt32(message.serverKeepalive);
          pkt.writeInt32(message.clientKeepalive);
        }       
           
        break;
      
      //
      // Response: NET_CONNECTION_CLOSE
      //
      case RTMFP.NET_CONNECTION_CLOSE:
        //form close message
        pkt.writeInt8(RTMFP_MARKER_RESPONSE_2); //response without echo time
        pkt.writeInt16(_timeNow());
        pkt.writeInt8(0x0c);
        pkt.writeInt16(0);
        break;
      
      //
      // Response: NET_GROUP_JOIN
      //
      case RTMFP.NET_GROUP_JOIN:
        //TODO: No echo time if latency > 30 sec
        pkt.writeInt8(RTMFP_MARKER_RESPONSE_1); //response with echo time
        pkt.writeInt16(_timeNow());
        pkt.writeInt16(message.sentTime);
        this.writeAck(pkt, message.flow, message.stage, true);
        
        //If group exists we have peer ids to add
        if(message.peers && message.peers.length > 0)
        {
          pkt.writeInt8(0x10);
          
          var sizePos = pkt.pos();
          pkt.skip(2); //size placeholder
          
          pkt.writeInt8(message.flag); 
          pkt.writeInt8(message.flow); 
          pkt.writeInt8(message.stage); 
          pkt.writeInt8(message.delta); 
          
          pkt.writeInt8(0x03);
          pkt.writeBuffer(message.signature);
          pkt.writeBuffer(message.unknown1);
          pkt.writeInt8(0x03);
          
          pkt.writeInt16(0x0b);
          pkt.writeBuffer(message.peers[0].peerId);
          
          //write size finally
          writeSize(pkt, sizePos, pkt.size() - sizePos - 2);
          
          //Append additional peer ids
          for(var i = 1; i < message.peers.length; i++)
          {
            pkt.writeInt8(0x11);
            pkt.writeInt16(0x22);
            pkt.writeInt16(0x0b);
            pkt.writeBuffer(message.peers[i].peerId);
          }      
        
        }
        break;
      
      //
      // Response: NET_GROUP_LEAVE
      //
      case RTMFP.NET_GROUP_LEAVE:
        //TODO: No echo time if latency > 30 sec
        pkt.writeInt8(RTMFP_MARKER_RESPONSE_1); //response with echo time
        pkt.writeInt16(_timeNow());
        pkt.writeInt16(message.sentTime);
        this.writeAck(pkt, message.flow, message.stage, true);
        break;
      
      //
      // Response: RENDEZVOUZ
      //
      case RTMFP.RENDEZVOUZ_RESPONSE:
        pkt.writeInt8(RTMFP_MARKER_HANDSHAKE);
        pkt.writeInt16(_timeNow());
        pkt.writeInt8(0x71);
        
        var sizePos = pkt.pos();
        pkt.skip(2); //size placeholder
        
        pkt.writeInt8(message.tag.length);
        pkt.writeBuffer(message.tag);
        
        var publicFlag = true;
        for(var i = 0; i < message.addresses.length; i++)
        {
          //TODO: get public/private flag from address itself
          this.writeAddress(pkt, message.addresses[i], publicFlag);
          publicFlag = false;
        }
          
        //write size finally
        writeSize(pkt, sizePos, pkt.size() - sizePos - 2);
        
        break;
      
      //
      // Response: RENDEZVOUZ_NEWCOMER
      //
      case RTMFP.RENDEZVOUZ_NEWCOMER:
        //TODO: use a general function to write the correct time depending on echoTime
        pkt.writeInt8(RTMFP_MARKER_RESPONSE_1); //echo time
        pkt.writeInt16(_timeNow());
        pkt.writeInt16(message.echoTime);
        pkt.writeInt8(0x0f);
        
        var sizePos = pkt.pos();
        pkt.skip(2); //size placeholder
        
        //TODO: write real size 2x U29
        pkt.writeBytes([0x22, 0x21, 0x0f]);
        
        //Write Peer Id (of the peer we send the newcomer message to)
        if(!message.peerId || message.peerId.length != 32){
          throw new Error('Peer id for newcomer request mandatory and has to be 32 bytes.');
        }
        pkt.writeBuffer(message.peerId);
        
        //TODO: get public/private marker from address itself
        this.writeAddress(pkt, message.address, message.pp);
        
        pkt.writeBuffer(message.tag);
        
        //write size finally
        writeSize(pkt, sizePos, pkt.size() - sizePos - 2);
        
        break;
      
      //
      // Response: KEEPALIVE_REQUEST
      //
      case RTMFP.KEEPALIVE_REQUEST:
        
        break;
        
      //
      // Response: KEEPALIVE
      //
      case RTMFP.KEEPALIVE_RESPONSE:
        //TODO: No echo time if latency > 30 sec
        pkt.writeInt8(RTMFP_MARKER_RESPONSE_1); //response with echo time
        pkt.writeInt16(_timeNow());
        pkt.writeInt16(message.sentTime);
        pkt.writeInt8(0x41);
        pkt.writeInt16(0x0);
        break;
        
      //
      // Response: ACK 
      //
      case RTMFP.ACK:
        pkt.writeInt8(RTMFP_MARKER_RESPONSE_1); //response with echo time
        pkt.writeInt16(_timeNow());
        pkt.writeInt16(message.sentTime);
        this.writeAck(pkt, message.flow, message.stage, true);
        break;
        
      //
      // Response: NACK
      //
      case RTMFP.NOT_ACK:
        pkt.writeInt8(RTMFP_MARKER_RESPONSE_1); //response with echo time
        pkt.writeInt16(_timeNow());
        pkt.writeInt16(message.sentTime);
        this.writeAck(pkt, message.flow, message.stage, false);
        break;
      
      //
      // NC_FAILED_RESPONSE
      //
      case RTMFP.NC_FAILED_RESPONSE:
        pkt.writeInt8(0x8d); //response with echo time
        pkt.writeInt16(_timeNow());
        pkt.writeInt16(message.echoTime);
        pkt.writeInt8(0x10);
        pkt.writeInt16(4);
        pkt.writeInt8(3);
				pkt.writeInt8(message.flow);
				pkt.writeInt8(message.stage);
				pkt.writeInt8(0);
				
        break;
      
      //
      // NC_FAILED_REQUEST
      //
      case RTMFP.NC_FAILED_REQUEST:
        pkt.writeInt8(0x4a); //response without echo time
        pkt.writeInt16(_timeNow());
        pkt.writeInt8(0x5e);
        pkt.writeInt16(2);
        pkt.writeInt8(message.flow);
				pkt.writeInt8(0);
				
        break;
        
      //
      // Response: UNKNOWN
      //
      case RTMFP.UNKNOWN:
        //Do nothing
        break;
    }
    
    return pkt;
  };
  
  /** 
   * Writes packet size to given position and returns to current write position
   */
  var writeSize = function(pkt, pos, size) {
    var lastPos = pkt.pos();
    pkt.pos(pos);
    pkt.writeInt16( pkt.size() - pos - 2);
    pkt.pos(lastPos);
  };
  
  /**
   * Writes ack/nack to the packet
   */
  this.writeAck = function(pkt, flow, stage, ack)
  {
    // Write Acknowledgment
    pkt.writeInt8(0x51);
    pkt.writeInt16(3);
    pkt.writeInt8(flow);
    pkt.writeInt8((ack) ? 0x7f : 0x00);
    pkt.writeInt8(stage);
    return true;
  }
  
  /**
   * Read a byte encoded address/port endpoint
   *
   * @param {Packet} pkt
   * @return {endpoint}
   */
  this.readRawIpv4 = function(pkt){
    var endpoint = {};
    endpoint.address = pkt.readInt8() + '.' + pkt.readInt8() + '.' + pkt.readInt8() + '.' + pkt.readInt8();
    endpoint.port = pkt.readInt16();
    return endpoint;
  };
  
  function ipv6ToBytes(ip){
    var parts = ip.split(':');
    for(k in parts){
      if(parts[k] === '0'){
        parts[k] = '0000';
      }
      for(var z = 0; z < 4 - parts[k].length; z++){
        parts[k] = '0' + parts[k];
      }
    }
    return new Buffer(parts.join(''), 'hex');
  };

  /**
   * Reads an IP address and port combination from a packet
   */
  this.readAddress = function(pkt) {
    var rawAddress = pkt.readBytes(pkt.readInt16()).toString();
    var colonPos = rawAddress.lastIndexOf(':');
    var endpoint = { address: rawAddress.substr(0, colonPos)};
    
    if(endpoint.address.substr(0, 1) == '['){
      endpoint.address = ipv6ToBytes(endpoint.address.substr(1, endpoint.address.length - 2));
      endpoint.is_IPv6 = true;
    }
    
    endpoint.port = rawAddress.substr(colonPos + 1)
    return endpoint;
  };
  
  /**
   * Writes an IP address and port combination to a packet
   */
  this.writeAddress = function(pkt, endpoint, isPublic) {
    //validate addresses (has address and port)
    if(!endpoint.address || !endpoint.port) {
      throw new Error('An endpoint needs an address and a port');
    }
    
    //TODO: implement endpoint distinction
    if(endpoint.is_IPv6)
    {
      //IPv6
      pkt.writeInt8(isPublic ? 0x82 : 0x81);
      pkt.writeBuffer(endpoint.address);
    } else {
      //IPv4
      pkt.writeInt8(isPublic ? 0x02 : 0x01);
      var ipParts = endpoint.address.split('.');
      for(k in ipParts){
        pkt.writeInt8(ipParts[k]);
      }
    }
    pkt.writeInt16(endpoint.port);
  };
  
  /**
   * Reads the connection id from the packet and sets the buffer position to 4
   */
  this.decodePacket = function(pkt){
    pkt.pos(0);
    var connection_id = 0;
    for(i = 0; i < 3; ++i)
      connection_id ^= pkt.readInt32();
    pkt.pos(4);
    return connection_id;
  };
  
  /**
   * Adds the connection id to the packet
   */
  this.encodePacket = function(pkt, connectionId){
    pkt.pos(4);
    var encodedId = pkt.readInt32() ^ pkt.readInt32() ^ connectionId;
    pkt.pos(0);
    pkt.writeInt32(encodedId);
  };
  
  /**
   * Get the checksum for the packet
   */
  this.packetChecksum = function(pkt) {
    var sum = 0, pos = pkt.pos();
    pkt.pos(6);
    
    while(pkt.available() > 0)
      sum += (pkt.available() == 1) ? pkt.readInt8() : pkt.readInt16();
    
    pkt.pos(pos);
    
    return _rtmfp.finishChecksum(sum);
  };
  
  /**
   * Decrypts the packet with the given key,
   * returns true if the decrypted packet matches the checksum.
   */
  this.decryptPacket = function(pkt, key) {
    if(!pkt || !key){
      throw new Error('Cannot decrypt with either missing packet or key');
    }
    _rtmfp.decryptBuffer(pkt.buffer(), key, 4);
    pkt.pos(4);
    var check = pkt.readInt16();
    var comp = this.packetChecksum(pkt);
    return (check == comp);
  };
  
  /**
   * Encrypts the packet with the given key and adds the checksum.
   */
  this.encryptPacket = function(pkt, key){
    //Ensure pkt and key are given, otherwise we risk crashing the C Module
    if(!pkt || !key){
      throw new Error('Cannot encrypt with either missing packet or key');
    }
    
    //Add padding bytes to the end
    var paddingBytesLength = _rtmfp.paddingLength(pkt.size());
    pkt.pos(pkt.size());
    for(i = 0; i < paddingBytesLength; i++){
      pkt.writeInt8(0xFF);
    }
         
    //Write Checksum
    pkt.pos(4);
    var comp = this.packetChecksum(pkt);
    pkt.writeInt16(comp);
    pkt.pos(4);
    var check = pkt.readInt16();
    
    _rtmfp.encryptBuffer(pkt.buffer(), pkt.size(), key, 4);
  };
  
  /**
   * Create server nonce part
   */
  this.createServerNonce = function(publicKey){
    if(!publicKey){
      throw new Error('Public Key needs to be a Buffer');
    }
    var serverNonce = new Packet(new Buffer(11 + publicKey.length));
    serverNonce.writeBytes([0x03,0x1a,0x00,0x00,0x02,0x1e,0x00,0x81,0x02,0x0d,0x02]);
    serverNonce.writeBuffer(publicKey);
    return serverNonce.buffer();
  };
  
  /**
   * Create client nonce part
   */
  this.createClientNonce = function(certificate){
    if(!certificate){
      throw new Error('Certificate needs to be a Buffer');
    }
    var clientNonce = new Packet(new Buffer(76));
    clientNonce.writeBytes([0x02, 0x1d, 0x02, 0x41, 0x0e]);
    clientNonce.writeBuffer(certificate);
    clientNonce.writeBytes([0x03, 0x1a, 0x02, 0x0a, 0x02, 0x1e, 0x02]);
    return clientNonce.buffer();
  };
  
  var _timeNow = function() {
    var d = new Date();
    return Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()) - _epoch) / 4);
  };
  
};

//statics
RTMFP.UNKNOWN = 0x00;
RTMFP.RENDEZVOUZ_REQUEST = 0x01;
RTMFP.RENDEZVOUZ_RESPONSE = 0x02;
RTMFP.RENDEZVOUZ_NEWCOMER = 0x03;
RTMFP.HANDSHAKE_REQUEST = 0x04;
RTMFP.HANDSHAKE_RESPONSE = 0x05;
RTMFP.KEY_REQUEST = 0x06;
RTMFP.KEY_RESPONSE = 0x07;
RTMFP.KEEPALIVE_REQUEST = 0x08;
RTMFP.KEEPALIVE_RESPONSE = 0x09;
RTMFP.NET_CONNECTION_CLOSE = 0x0A;
RTMFP.NET_CONNECTION_REQUEST = 0x0B;
RTMFP.NET_CONNECTION_RESPONSE = 0x0C;
RTMFP.NET_GROUP_JOIN = 0x0D;
RTMFP.NET_GROUP_LEAVE = 0x0E;
RTMFP.NET_CONNECTION_ADDRESSES = 0x0F;
RTMFP.ACK = 0x10;
RTMFP.NOT_ACK = 0x11;
RTMFP.NC_FAILED_REQUEST = 0x12;
RTMFP.NC_FAILED_RESPONSE = 0x13;
RTMFP.COMMAND = 0x14;
RTMFP.COMMAND_RESULT = 0x15;
RTMFP.COMMAND_ERROR = 0x16;
RTMFP.FORWARD_REQUEST = 0x17;
RTMFP.FORWARD_RESPONSE = 0x18;
RTMFP.SYMETRIC_KEY = new Buffer('Adobe Systems 02');
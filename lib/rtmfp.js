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

var Packet = require('./packet.js');
var AMF = require('./amf.js');
var AMF0 = require('./amf0.js');
var nativeRTMFP = require('../build/default/rtmfp.node');

//Packet Markers
var RTMFP_MARKER_HANDSHAKE = 0x0b,
RTMFP_MARKER_MESSAGE_1 = 0x0d,
RTMFP_MARKER_MESSAGE_2 = 0x8d,
RTMFP_MARKER_MESSAGE_3 = 0x89,
RTMFP_MARKER_MESSAGE_4 = 0x09,
RTMFP_MARKER_RESPONSE_1 = 0x4e
RTMFP_MARKER_RESPONSE_2 = 0x4a

var RTMFP = module.exports = function(settings){
  
  //TODO: specifiy those settings in the message in writePacket
  var _settings = {
    serverKeepalive: 60,
    clientKeepalive: 60
  };
  
  //Merge settings
  for(k in settings) {
    _settings[k] = settings[k];
  }
  
  var _rtmfp = new nativeRTMFP.RTMFP();
  
  var _serverSignature = new Packet(new Buffer(11)).writeBytes([0x03,0x1a,0x00,0x00,0x02,0x1e,0x00,0x81,0x02,0x0d,0x02]).buffer();
  var _serverCertificate = new Packet(new Buffer(77)).writeBytes([0x01,0x0A,0x41,0x0E]).writeRandom(64).writeBytes([0x02,0x15,0x02,0x02,0x15,0x05,0x02,0x15,0x0E]).buffer();
  
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
    
    if (marker != 0x8d && marker != 0x0d && marker != 0x0b && marker != 0x89 && marker != 0x09 && marker != 0x49)
      return false;
    
    var time1 = pkt.readInt16();
    var time2 = 0;
    
    var message = null;
    
    //with echo time
    if ((marker | 0xF0) == 0xFD) {
      time2 = pkt.readInt16();
    }
    
    while(pkt.available() > 0 && (
          pkt.peek() == 0x10 || 
          pkt.peek() == 0x11 || 
          pkt.peek() == 0x30 || 
          pkt.peek() == 0x38 || 
          pkt.peek() == 0x51 ||
          pkt.peek() == 0x01 || 
          pkt.peek() == 0x41 || 
          pkt.peek() == 0x0c || 
          pkt.peek() == 0x4c || 
          pkt.peek() == 0x5e || 
          pkt.peek() == 0x18)
    )
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
    if(pkt.available() < messageSize)
      return null;
      
    //Clip packet to size
    var clippedPkt = new Packet(pkt.readBytes(messageSize), messageSize);
    var message = null;
    
    switch(type)
    {
      //
      // Message: HANDSHAKE / RENDEZVOUZ
      //
      case 0x30:
        var msgLength;
        var handshakeType;
        
        //size type 0x81 is U29 value and followed by two more bytes with U29 value
        if(clippedPkt.peek() != 0x81)
        {
          clippedPkt.skip(1);
          msgLength = clippedPkt.readInt8() - 1;
        } else {
          clippedPkt.skip(2);
          msgLength = clippedPkt.readU29() - 1;
        }
        
        var handshakeType = clippedPkt.readInt8();
        
        //Rendevouz
        if(handshakeType == 0x0f)
        {
          message = { type: RTMFP.RENDEZVOUZ };
          message.peerId = clippedPkt.readBytes(32, true);
        }
        else if(handshakeType == 0x0a)
        {
          message = { type: RTMFP.HANDSHAKE_1 };
          //URL connected to
          message.url = clippedPkt.readBytes(msgLength).toString('ascii');
        }
        
        if(message == null){
          //something went very wrong, dump the packet and exit
          throw new Error('Message is null after reading handshake: ' + clippedPkt.toString());
        }
        
        message.tag = clippedPkt.readBytes(16, true);
          
        break;
      
      //
      // Message: HANDSHAKE_2
      //
      case 0x38:
        message = { type: RTMFP.HANDSHAKE_2 };
        message.connectionId = clippedPkt.readInt32();
        var cookie_size = clippedPkt.readInt8();
        if(cookie_size != 64)
        {
          throw new Error('COOKIE SIZE != 64');
        }
        message.cookie = clippedPkt.readBytes(cookie_size);
        
        var keySize = clippedPkt.readU29();
        
        var sig_size = 4;
        if(keySize == 131)
        {
          throw new Error('handshake client key size wrong! (' + keySize + ')');
        }
        
        var pos = clippedPkt.pos();
        
        message.clientSignature = clippedPkt.readBytes(sig_size);
        message.clientKey = clippedPkt.readBytes(keySize - sig_size);
        
        clippedPkt.pos(pos);
        var keyPlusSig = clippedPkt.readBytes(keySize);
        
        var certificate_size = clippedPkt.readInt8();
        if(certificate_size != 76)
        {
          throw new Error('handshake client certificate size exceeded!');
        }
        
        message.clientCertificate = clippedPkt.readBytes(certificate_size);
        
        //Compute the client peer id
        message.peerId = _rtmfp.computePeerId(keyPlusSig, keySize);
        
        break;
     
      
      //
      // Message: KEEPALIVE
      //
      case 0x01:
        message = { type: RTMFP.KEEPALIVE };
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
        var sequence = clippedPkt.readInt8();
        var ackMarker = clippedPkt.readInt8();
        if(ackMarker == 0xFF) //happens after response is resend many times...
        {
          ackMarker = clippedPkt.readInt8();
        }
        message = { type: (ackMarker == 0x7f) ? RTMFP.ACK : RTMFP.NOT_ACK };
        message.sequence = sequence;
        message.stage = clippedPkt.readInt8();
        break;
      
      //
      // Message: UNKNOWN_0x5e
      //
      case 0x5e:
        message = { type: RTMFP.UNKNOWN_0x5e };
        message.sequence = clippedPkt.readInt8();
        break;
      
      //
      // Message: UNKNOWN
      //
      case 0x18: 
        throw new Error('UNHANDLED MESSAGE TYPE 0x18');
        break;
      
      //
      // Message: SEQUENCE (RPC || GROUP)
      //
      case 0x10 : 
      case 0x11 :
        message = {};
        message.flag = clippedPkt.readInt8(); // 0x80 extended header, 0x00 non extended header
        
        if(type == 0x11 && lastMessage != null) {
          message.sequence = lastMessage.sequence;
          message.stage = lastMessage.stage;
          message.delta = lastMessage.delta;
          if(lastMessage.signature) {
            message.signature = lastMessage.signature;
          }
        } else {
          message.sequence = clippedPkt.readInt8();
          message.stage = clippedPkt.readInt8();
          message.delta = clippedPkt.readInt8();
        }
        
        if(message.flag == 0x80) {
          message.signature = clippedPkt.readBytes(clippedPkt.readInt8(), true);
        } 
        
        //Sometimes 11 00 01 03 is appended to Group Join, don't know why...
        if(messageSize == 1) {
          return null;
        }
        
        if(message.sequence == 0x02)
        {
          //TODO: investigate
          message.unknown2 = clippedPkt.readBytes(6);
          
          message.commandName = AMF0.readString(clippedPkt);
          message.commandHandle = AMF0.readNumber(clippedPkt);
          
          switch(message.commandName) {
            //Handle NetConnection 
            case 'connect':
              message.type = RTMFP.NET_CONNECTION_OPEN;
              //Read AMF Data
              //TODO: only read AMF data if null marker
              message.commandData = AMF.readAMF0(clippedPkt);
              break;
            
            //Handle Addresses for NetConnection
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
        else if(message.sequence > 0x02 && message.stage == 0x01)
        {
          message.type = RTMFP.NET_GROUP_JOIN;
          message.unknown1 = clippedPkt.readBytes(2); //Unknown data
          clippedPkt.skip(3);
          message.groupId = clippedPkt.readBytes(clippedPkt.readU29(), true);
        }
        
        //NetGroup stage 2
        else if(message.sequence > 0x02 && message.stage == 0x02)
        {
          message.type = RTMFP.NET_GROUP_LEAVE;
        }
        
        break;
      
      default:
        return message;
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
      // Response: HANDSHAKE_1
      //
      case RTMFP.HANDSHAKE_1:
        pkt.writeInt8(RTMFP_MARKER_HANDSHAKE);
        pkt.writeInt16(_timeNow());
        pkt.writeInt8(0x70);
        pkt.writeInt16(16 + message.cookie.length + _serverCertificate.length + 2);
        
        pkt.writeInt8(16);
        pkt.writeBuffer(message.tag);
        
        pkt.writeInt8(message.cookie.length);
        pkt.writeBuffer(message.cookie);
        
        pkt.writeBuffer(_serverCertificate);
        
        break;
        
      //
      // Response: FORWARD
      //
      case RTMFP.FORWARD:
        pkt.writeInt8(RTMFP_MARKER_HANDSHAKE);
        pkt.writeInt16(_timeNow());
        pkt.writeInt8(0x71);
        
        var sizePos = pkt.pos();
        pkt.skip(2); //size placeholder
        
        pkt.writeInt8(16);
        pkt.writeBuffer(message.tag);
        
        for(var i = 0; i < message.addresses.length; i++) {
          this.writeAddress(pkt, message.addresses[i], false);
        }
        
        //write size finally
        writeSize(pkt, sizePos, pkt.size() - sizePos - 2);
                
        break;
        
      //
      // Response: HANDSHAKE_2
      //
      case RTMFP.HANDSHAKE_2:
        pkt.writeInt8(RTMFP_MARKER_HANDSHAKE);
        pkt.writeInt16(_timeNow());
        pkt.writeInt8(0x78);
        pkt.writeInt16(_serverSignature.length + message.serverKey.length + 7);
        
        pkt.writeInt32(message.connectionId);
        
        //Todo: writeU29 method for packet
        //pkt.writeU29(server_signature.size() + sizeof(message.server_key));
        
        pkt.writeInt8(0x81);
        pkt.writeInt8(_serverSignature.length);
        
        pkt.writeBuffer(_serverSignature);
        pkt.writeBuffer(message.serverKey);
        
        pkt.writeInt8(0x58);
        
        break;
      
      //
      // Response: NET_CONNECTION_OPEN
      // TODO: add and handle NET_CONNECTION_FAILED & NET_CONNECTION_SUCCESS
      //
      case RTMFP.NET_CONNECTION_OPEN:
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
        pkt.writeInt8(message.sequence);
        pkt.writeInt8(message.stage);
        pkt.writeInt8(0x01); // 0x01 flag to ack previus command
        
        //Echo message signature
        //TODO: only echo if flag says so?
        pkt.writeInt8(message.signature.length);
        pkt.writeBuffer(message.signature);
        
        pkt.writeBytes([0x02, 0x0a, 0x02]); //TODO: replace last byte with sequence id?
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
        pkt.writeInt8(message.sequence);
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
          pkt.writeInt32(_settings.serverKeepalive * 1000);
          pkt.writeInt32(_settings.clientKeepalive * 1000);
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
        this.writeAck(pkt, message.sequence, message.stage, true);
        
        //If group exists we have peer ids to add
        if(message.peers && message.peers.length > 0)
        {
          pkt.writeInt8(0x10);
          
          var sizePos = pkt.pos();
          pkt.skip(2); //size placeholder
          
          pkt.writeInt8(message.flag); 
          pkt.writeInt8(message.sequence); 
          pkt.writeInt8(message.stage); 
          pkt.writeInt8(message.delta); 
          
          pkt.writeInt8(0x03);
          pkt.writeBuffer(message.signature);
          pkt.writeBuffer(message.unknown1);
          pkt.writeInt8(0x03);
          
          pkt.writeInt16(0x0b);
          pkt.writeBuffer(message.peers[0].peerId());
          
          //remember size for first message
          var size = pkt.size() - sizePos - 2;
          
          for(var i = 1; i < message.peers.length; i++)
          {
            pkt.writeInt8(0x11);
            pkt.writeInt16(0x22);
            pkt.writeInt16(0x0b);
            pkt.writeBuffer(message.peers[i].peerId());
          }      
          
          //write size finally
          writeSize(pkt, sizePos, pkt.size() - sizePos - 2);
        
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
        this.writeAck(pkt, message.sequence, message.stage, true);
        break;
      
      //
      // Response: RENDEZVOUZ
      //
      case RTMFP.RENDEZVOUZ:
        pkt.writeInt8(RTMFP_MARKER_HANDSHAKE);
        pkt.writeInt16(_timeNow());
        pkt.writeInt8(0x71);
        
        var sizePos = pkt.pos();
        pkt.skip(2); //size placeholder
        
        pkt.writeInt8(0x10);
        pkt.writeBuffer(message.tag);
        
        var publicFlag = true;
        for(var i = 0; i < message.addresses.length; i++)
        {
          this.writeAddress(pkt, message.addresses[i], publicFlag);
          publicFlag = false;
        }
          
        //write size finally
        writeSize(pkt, sizePos, pkt.size() - sizePos - 2);
        
        break;
      
      //
      // Response: RENDEZVOUZ_2
      //
      case RTMFP.RENDEZVOUZ_2:
        //TODO: send without echo time
        pkt.writeInt8(RTMFP_MARKER_RESPONSE_1);
        pkt.writeInt16(_timeNow());
        pkt.writeInt16(message.sentTime); //wtf?
        pkt.writeInt8(0x0f);
        
        var sizePos = pkt.pos();
        pkt.skip(2); //size placeholder
        
        pkt.writeBytes([0x22, 0x21, 0x0f]);
        
        pkt.writeBuffer(message.peer.peerId());
        
        this.writeAddress(pkt, message.address, true);
        
        pkt.writeBuffer(message.tag);
        
        //write size finally
        writeSize(pkt, sizePos, pkt.size() - sizePos - 2);
        
        break;
      
      //
      // Response: KEEPALIVE_RESPONSE
      //
      case RTMFP.KEEPALIVE_RESPONSE:
        //Nothing needs to be done here
        break;
        
      //
      // Response: KEEPALIVE
      //
      case RTMFP.KEEPALIVE:
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
        this.writeAck(pkt, message.sequence, message.stage, true);
        break;
        
      //
      // Response: NACK
      //
      case RTMFP.NOT_ACK:
        pkt.writeInt8(RTMFP_MARKER_RESPONSE_1); //response with echo time
        pkt.writeInt16(_timeNow());
        pkt.writeInt16(message.sentTime);
        this.writeAck(pkt, message.sequence, message.stage, false);
        break;
      
      //
      // Response: UNKNOWN_0x5e
      //
      case RTMFP.UNKNOWN_0x5e:
        //TODO: No echo time if latency > 30 sec
        pkt.writeInt8(RTMFP_MARKER_RESPONSE_1); //response with echo time
        pkt.writeInt16(_timeNow());
        pkt.writeInt16(message.sentTime);
        pkt.writeInt8(0x10);
        pkt.writeInt16(4);
        pkt.writeInt8(3);
				pkt.writeInt8(message.sequence);
				pkt.writeInt8(1);
				pkt.writeInt8(1);
				
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
  this.writeAck = function(pkt, sequence, stage, ack)
  {
    // Write Acknowledgment
    pkt.writeInt8(0x51);
    pkt.writeInt16(3);
    pkt.writeInt8(sequence);
    pkt.writeInt8((ack) ? 0x3f : 0x00);
    pkt.writeInt8(stage);
    return true;
  }
  
  /**
   * Reads an IP address and port combination from a packet
   */
  this.readAddress = function(pkt) {
    var rawAddress = pkt.readBytes(pkt.readInt16()).toString();
    var colonPos = rawAddress.lastIndexOf(':');
    var endpoint = { address: rawAddress.substr(0, colonPos)};
    
    if(endpoint.address.substr(0, 1) == '[')
      endpoint.address = endpoint.address.substr(1, endpoint.address.length - 2);
    
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
    if(endpoint.is_v6)
    {
      //IPv6
      pkt.writeInt8(isPublic ? 0x82 : 0x81);
      pkt.writeBuffer(new Buffer(endpoint.address));
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
    if(!pkt || !key)
      throw new Error('Packet and key have both to be given!');
  
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
   * Compute the servers keypair in a Diffie Hellman key exchange.
   * Decrypt and encrypt key will be saved in the corresponding NetConnection.
   * The generated publicServerKey will be returned to the client.
   * returns [publicServerKey, decryptKey, encryptKey]
   */
  this.computeAsymetricKeys = function(clientKey, clientCertificate) {
    return _rtmfp.computeAsymetricKeys(clientKey, clientCertificate, _serverSignature);
  };
  
  var _timeNow = function() {
    var d = new Date();
    return Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()) - _epoch) / 4);
  };
  
};

//statics
RTMFP.UNKNOWN = 0x00;
RTMFP.RENDEZVOUZ = 0x01;
RTMFP.RENDEZVOUZ_2 = 0x02;
RTMFP.HANDSHAKE_1 = 0x03;
RTMFP.HANDSHAKE_2 = 0x04;
RTMFP.KEEPALIVE = 0x05;
RTMFP.KEEPALIVE_RESPONSE = 0x06;
RTMFP.NET_CONNECTION_CLOSE = 0x07;
RTMFP.NET_CONNECTION_OPEN = 0x08;
RTMFP.NET_GROUP_JOIN = 0x09;
RTMFP.NET_GROUP_LEAVE = 0x0A;
RTMFP.NET_CONNECTION_ADDRESSES = 0x0B;
RTMFP.ACK = 0x0C;
RTMFP.NOT_ACK = 0x0D;
RTMFP.UNKNOWN_0x5e = 0x0E;
RTMFP.COMMAND = 0x0F;
RTMFP.COMMAND_RESULT = 0x10;
RTMFP.COMMAND_ERROR = 0x11;
RTMFP.FORWARD = 0x12;
RTMFP.SYMETRIC_KEY = new Buffer('Adobe Systems 02');
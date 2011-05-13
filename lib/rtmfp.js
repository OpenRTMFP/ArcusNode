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

var console = require('console');
var Packet = require('./packet.js');
var nativeRTMFP = require('../build/default/rtmfp.node');

//Packet Markers
var RTMFP_MARKER_HANDSHAKE = 0x0b,
RTMFP_MARKER_REQUEST_1 = 0x0d,
RTMFP_MARKER_REQUEST_2 = 0x8d,
RTMFP_MARKER_REQUEST_3 = 0x89,
RTMFP_MARKER_REQUEST_4 = 0x09,
RTMFP_MARKER_RESPONSE_1 = 0x4e
RTMFP_MARKER_RESPONSE_2 = 0x4a

module.exports = function(settings){
  
  var _settings = {
    serverKeepalive: 60,
    clientKeepalive: 60
  };
  
  //Merge settings
  for(k in settings)
    _settings[k] = settings[k];
    
  var _rtmfp = new nativeRTMFP.RTMFP();
  var _serverSignature = new Packet(new Buffer(11)).writeBytes([0x03,0x1a,0x00,0x00,0x02,0x1e,0x00,0x81,0x02,0x0d,0x02]).buffer();
  var _serverCertificate = new Packet(new Buffer(77)).writeBytes([0x01,0x0A,0x41,0x0E]).writeRandom(64).writeBytes([0x02,0x15,0x02,0x02,0x15,0x05,0x02,0x15,0x0E]).buffer();
  var _epoch = (function(){
    var d = new Date();
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
  })();
  
  this.getRequests = function(pkt){
    requests = [];
    pkt.pos(6);
    
    var marker = pkt.readInt8();
    
    if (marker != 0x8d && marker != 0x0d && marker != 0x0b && marker != 0x89 && marker != 0x09 && marker != 0x49)
      return false;
    
    var time1 = pkt.readInt16();
    var time2 = 0;
    
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
      var request = this.getRequest(pkt);
      if(request)
      {
        var now = _timeNow();
        request.receivedTime = now;
        request.sentTime = time1;
        request.echoTime = time2;
        if(time2 > 0)
          request.latency = now - time2;
        requests.push(request);
      }
    }
    return requests;
  };
  
  this.getRequest = function(pkt){
    var type = pkt.readInt8();
    
    //Ensure packet bytes
    if(pkt.available() < 2)
      return null;
      
    var requestSize = pkt.readInt16();
    
    //Ensure packet bytes
    if(pkt.available() < requestSize)
      return null;
      
    var request = null;
    
    switch(type)
    {
      //
      // Request: HANDSHAKE / RENDEZVOUZ
      //
      case 0x30:
        var msgLength;
        var handshakeType;
        
        //size type 0x81 is 7bit value and followed by two more bytes with 7bit value
        if(pkt.peek() != 0x81)
        {
          pkt.skip(1);
          msgLength = pkt.readInt8() - 1;
        } else {
          pkt.skip(2);
          msgLength = pkt.read7Bit() - 1;
        }
        
        var handshakeType = pkt.readInt8();
        
        //Rendevouz
        if(handshakeType == 0x0f)
        {
          request = { type: types.RENDEZVOUZ };
          request.peerId = pkt.readBytes(32, true);
        }
        else if(handshakeType == 0x0a)
        {
          request = { type: types.HANDSHAKE_1 };
          //URL connected to unused, so skipped
          pkt.skip(msgLength);
        }
        
        request.tag = pkt.readBytes(16, true);
          
        break;
      
      //
      // Request: HANDSHAKE_2
      //
      case 0x38:
        request = { type: types.HANDSHAKE_2 };
        request.connectionId = pkt.readInt32();
        var cookie_size = pkt.readInt8();
        if(cookie_size != 64)
        {
          throw new Error('COOKIE SIZE != 64');
        }
        request.cookie = pkt.readBytes(cookie_size);
        
        var keySize = pkt.read7Bit();
        
        var sig_size = 4;
        if(keySize == 131)
        {
          throw new Error('handshake client key size wrong! (' + keySize + ')');
        }
        
        var pos = pkt.pos();
        
        request.clientSignature = pkt.readBytes(sig_size);
        request.clientKey = pkt.readBytes(keySize - sig_size);
        
        pkt.pos(pos);
        var keyPlusSig = pkt.readBytes(keySize);
        
        var certificate_size = pkt.readInt8();
        if(certificate_size != 76)
        {
          throw new Error('handshake client certificate size exceeded!');
        }
        
        request.clientCertificate = pkt.readBytes(certificate_size);
        
        //Compute the client peer id
        request.peerId = _rtmfp.computePeerId(keyPlusSig, keySize);
        
        break;
     
      
      //
      // Request: KEEPALIVE
      //
      case 0x01:
        request = { type: types.KEEPALIVE };
        break;
      
      //
      // Request: KEEPALIVE_RESPONSE
      //
      case 0x41 :
        request = { type: types.KEEPALIVE_RESPONSE };
        break;
      
      //
      // Request: NET_CONNECTION_CLOSE
      //
      case 0x0c:
      case 0x4c:
        request = { type: types.NET_CONNECTION_CLOSE };
        break;
            
      //
      // Request: ACK and NACK
      //
      case 0x51:
        var sequence = pkt.readInt8();
        var ackMarker = pkt.readInt8();
        if(ackMarker == 0xFF) //happens after response is resend many times...
        {
          ackMarker = pkt.readInt8();
        }
        request = { type: (ackMarker == 0x7f) ? types.ACK : types.NOT_ACK };
        request.sequence = sequence;
        request.stage = pkt.readInt8();
        break;
      
      //
      // Request: UNKNOWN_0x5e
      //
      case 0x5e:
        request = { type: types.UNKNOWN_0x5e };
        request.sequence = pkt.readInt8();
        break;
      
      //
      // Request: UNKNOWN
      //
      case 0x18: 
        throw new Error('UNHANDLED REQUEST TYPE 0x18');
        break;
      
      //
      // Request: SEQUENCE (RPC || GROUP)
      //
      case 0x10 :  
      case 0x11 :
        var flag = pkt.readInt8(); // Unknown, is 0x80 or 0x00
        var sequence = pkt.readInt8();
        var stage = pkt.readInt8();
      
        //Sometimes 11 00 01 03 is appended to Group Join, don't know why...
        if(requestSize == 1) 
          return request;
        
        if(pkt.readInt8() == 0x02) {
          // Unknown, skip
          pkt.skip(7);
        }
        
        if(sequence == 0x02)
        {
          if(stage == 0x01)
          {
            //TODO: implement AMF0 reading and read Action type and other data, like AUTH
            //For now we just treat it as a connection request
            request = { type: types.NET_CONNECTION_OPEN };
            //2 times 6 bytes unknown data
            request.unknown1 = pkt.readBytes(6);
            request.unknown2 = pkt.readBytes(6);
            
          } else {
            //Todo: read as rpc call, treat as net connection part 2 for now
            request = { type: types.NET_CONNECTION_ADDRESSES };
            pkt.skip(6); //Unknown data
            
            //Todo: Replace with AMF0 reading
            
            pkt.skip(24);
            
            request.addresses = [];
            while(pkt.available() > 3 && pkt.readInt8() == 0x02)
            {
              request.addresses.push(this.readAddress(pkt));
            }
          }
          
        }
        
        //NetGroup stage 1
        else if(sequence > 0x02 && stage == 0x01)
        {
          request = { type: types.NET_GROUP_JOIN };
          request.unknown1 = pkt.readBytes(6); //Unknown data
          pkt.skip(3);
          
          request.groupId = pkt.readBytes(pkt.read7Bit());
        }
        
        //NetGroup stage 2
        else if(sequence > 0x02 && stage == 0x02)
        {
          request = { type: types.NET_GROUP_LEAVE };
        }
        
        request.flag = flag; // Unknown, is 0x80 or 0x00
        request.sequence = sequence;
        request.stage = stage;
        
        break;
      
      default:
        return request;
        break;
    }
    
    return request;
  };
  
  /**
   * Writes the response to the packet, which can then be sent to the client
   */
  this.setResponse = function(pkt, request){
    pkt.pos(6);
    
    switch(request.type)
    {
      //
      // Response: HANDSHAKE_1
      //
      case types.HANDSHAKE_1:
        pkt.writeInt8(RTMFP_MARKER_HANDSHAKE);
        pkt.writeInt16(_timeNow());
        pkt.writeInt8(0x70);
        pkt.writeInt16(16 + request.cookie.length + _serverCertificate.length + 2);
        
        pkt.writeInt8(16);
        pkt.writeBuffer(request.tag);
        
        pkt.writeInt8(request.cookie.length);
        pkt.writeBuffer(request.cookie);
        
        pkt.writeBuffer(_serverCertificate);
        
        break;
        
      //
      // Response: HANDSHAKE_2
      //
      case types.HANDSHAKE_2:
        pkt.writeInt8(RTMFP_MARKER_HANDSHAKE);
        pkt.writeInt16(_timeNow());
        pkt.writeInt8(0x78);
        pkt.writeInt16(_serverSignature.length + request.serverKey.length + 7);
        
        pkt.writeInt32(request.connectionId);
        
        //Todo: write_7bit_value method for packet
        //pkt.write_7bit_value(server_signature.size() + sizeof(request.server_key));
        
        pkt.writeInt8(0x81);
        pkt.writeInt8(_serverSignature.length);
        
        pkt.writeBuffer(_serverSignature);
        pkt.writeBuffer(request.serverKey);
        
        pkt.writeInt8(0x58);
        
        break;
      
      //
      // Response: NET_CONNECTION_OPEN
      //
      case types.NET_CONNECTION_OPEN:
        //Todo: check if response was sent multiple times and after
        //30 sec send response without echo time (request.sentTime and request.echoTime)
        
        //TODO: No echo time if latency > 30 sec
        pkt.writeInt8(RTMFP_MARKER_RESPONSE_1); //response with echo time
        pkt.writeInt16(_timeNow());
        pkt.writeInt16(request.sentTime);
        
        this.writeAck(pkt, request.sequence, request.stage, true);
        
        // Prepare response
        pkt.writeInt8(0x10);
        
        var sizePos = pkt.pos();
        pkt.skip(2); //size placeholder
        
        pkt.writeInt8(request.flag);
        pkt.writeInt8(request.sequence);
        pkt.writeInt8(request.stage);
        pkt.writeInt8(0x01); // 0x01 flag to ack previus message
        
        //Echo yet unknown part from request
        pkt.writeBuffer(request.unknown1);
        pkt.writeBytes([0x02, 0x0a, 0x02]); //TODO: replace last byte with sequence id?
        pkt.writeBuffer(request.unknown2);
        
        //TODO: Replace with AMF0 writing
        pkt.writeBytes([
          0x02, 0x00, 0x07, 0x5f, 0x72, 0x65, 0x73, 0x75, 0x6c, 0x74, 0x00, 0x3f, 0xf0, 0x00, 0x00, 0x00, 
          0x00, 0x00, 0x00, 0x05, 0x03, 0x00, 0x0e, 0x6f, 0x62, 0x6a, 0x65, 0x63, 0x74, 0x45, 0x6e, 0x63, 
          0x6f, 0x64, 0x69, 0x6e, 0x67, 0x00, 0x40, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0b, 
          0x64, 0x65, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74, 0x69, 0x6f, 0x6e, 0x02, 0x00, 0x14, 0x43, 0x6f, 
          0x6e, 0x6e, 0x65, 0x63, 0x74, 0x69, 0x6f, 0x6e, 0x20, 0x73, 0x75, 0x63, 0x63, 0x65, 0x65, 0x64, 
          0x65, 0x64, 0x00, 0x05, 0x6c, 0x65, 0x76, 0x65, 0x6c, 0x02, 0x00, 0x06, 0x73, 0x74, 0x61, 0x74, 
          0x75, 0x73, 0x00, 0x04, 0x63, 0x6f, 0x64, 0x65, 0x02, 0x00, 0x1d, 0x4e, 0x65, 0x74, 0x43, 0x6f, 
          0x6e, 0x6e, 0x65, 0x63, 0x74, 0x69, 0x6f, 0x6e, 0x2e, 0x43, 0x6f, 0x6e, 0x6e, 0x65, 0x63, 0x74, 
          0x2e, 0x53, 0x75, 0x63, 0x63, 0x65, 0x73, 0x73, 0x00, 0x00, 0x09
        ]);
                
        //write size finally
        pkt.pos(sizePos);
        pkt.writeInt16( pkt.size() - sizePos - 2);
        
        break;
      
      //
      // Response: NET_CONNECTION_ADDRESSES
      //
      case types.NET_CONNECTION_ADDRESSES:
        //TODO: No echo time if latency > 30 sec
        pkt.writeInt8(RTMFP_MARKER_RESPONSE_1); //response with echo time
        pkt.writeInt16(_timeNow());
        pkt.writeInt16(request.sentTime);
        
        if(request.stage == 0x02)
        {
          pkt.writeInt8(0x10);
          pkt.writeInt16(0x13);
          pkt.writeBytes([0x00, 0x02, 0x02, 0x01, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x29]);
          pkt.writeInt32(_settings.serverKeepalive * 1000);
          pkt.writeInt32(_settings.clientKeepalive * 1000);
        }       
        
        this.writeAck(pkt, request.sequence, request.stage, true);
                
        break;
      
      //
      // Response: NET_CONNECTION_CLOSE
      //
      case types.NET_CONNECTION_CLOSE:
        //Nothing to do
        //TODO: send NetConnection.Connect.Closed message
        break;
      
      //
      // Response: NET_GROUP_JOIN
      //
      case types.NET_GROUP_JOIN:
        //TODO: No echo time if latency > 30 sec
        pkt.writeInt8(RTMFP_MARKER_RESPONSE_1); //response with echo time
        pkt.writeInt16(_timeNow());
        pkt.writeInt16(request.sentTime);
        this.writeAck(pkt, request.sequence, request.stage, true);
        
        //If group exists we have peer ids to add
        if(request.peers && request.peers.length > 0)
        {
          pkt.writeInt8(0x10);
          
          var sizePos = pkt.pos();
          pkt.skip(2); //size placeholder
          
          pkt.writeInt8(0x80); //Unknown flag
          pkt.writeInt8(request.sequence); 
          pkt.writeInt8(request.stage); 
          pkt.writeInt8(0x01); //Unknown flag
          
          pkt.writeBuffer(request.unknown1);
          pkt.writeInt8(0x03);
          
          pkt.writeInt16(0x0b);
          pkt.writeBuffer(request.peers[0].peerId());
          
          //remember size for first message
          var size = pkt.size() - sizePos - 2;
          
          for(var i = 1; i < request.peers.length; i++)
          {
            pkt.writeInt8(0x11);
            pkt.writeInt16(0x22);
            pkt.writeInt16(0x0b);
            pkt.writeBuffer(request.peers[i].peerId());
          }      
          
          //write size finally
          pkt.pos(sizePos);
          pkt.writeInt16(size);
        }
        break;
      
      //
      // Response: NET_GROUP_LEAVE
      //
      case types.NET_GROUP_LEAVE:
        //TODO: No echo time if latency > 30 sec
        pkt.writeInt8(RTMFP_MARKER_RESPONSE_1); //response with echo time
        pkt.writeInt16(_timeNow());
        pkt.writeInt16(request.sentTime);
        this.writeAck(pkt, request.sequence, request.stage, true);
        break;
      
      //
      // Response: RENDEZVOUZ
      //
      case types.RENDEZVOUZ:
        pkt.writeInt8(RTMFP_MARKER_HANDSHAKE);
        pkt.writeInt16(_timeNow());
        pkt.writeInt8(0x71);
        
        var sizePos = pkt.pos();
        pkt.skip(2); //size placeholder
        
        pkt.writeInt8(0x10);
        pkt.writeBuffer(request.tag);
        
        var publicFlag = true;
        for(var i = 0; i < request.addresses.length; i++)
        {
          this.writeAddress(pkt, request.addresses[i], publicFlag);
          publicFlag = false;
        }
          
        //write size finally
        pkt.pos(sizePos);
        pkt.writeInt16( pkt.size() - sizePos - 2);
      
        break;
      
      //
      // Response: RENDEZVOUZ_2
      //
      case types.RENDEZVOUZ_2:
        //TODO: send without echo time
        pkt.writeInt8(RTMFP_MARKER_RESPONSE_1);
        pkt.writeInt16(_timeNow());
        pkt.writeInt16(request.sentTime); //wtf?
        pkt.writeInt8(0x0f);
        
        var sizePos = pkt.pos();
        pkt.skip(2); //size placeholder
        
        pkt.writeBytes([0x22, 0x21, 0x0f]);
        
        pkt.writeBuffer(request.peer.peerId());
        
        this.writeAddress(pkt, request.address, true);
        
        pkt.writeBuffer(request.tag);
        
        //write size finally
        pkt.pos(sizePos);
        pkt.writeInt16( pkt.size() - sizePos - 2);
      
        break;
      
      //
      // Response: KEEPALIVE_RESPONSE
      //
      case types.KEEPALIVE_RESPONSE:
        //Nothing needs to be done here
        break;
        
      //
      // Response: KEEPALIVE
      //
      case types.KEEPALIVE:
        //TODO: No echo time if latency > 30 sec
        pkt.writeInt8(RTMFP_MARKER_RESPONSE_1); //response with echo time
        pkt.writeInt16(_timeNow());
        pkt.writeInt16(request.sentTime);
        pkt.writeInt8(0x41);
        pkt.writeInt16(0x0);
        break;
        
      //
      // Response: ACK and NACK
      //
      case types.ACK:
      case types.NOT_ACK:
        
        break;
      
      //
      // Response: UNKNOWN_0x5e
      //
      case types.UNKNOWN_0x5e:
        //TODO: No echo time if latency > 30 sec
        pkt.writeInt8(RTMFP_MARKER_RESPONSE_1); //response with echo time
        pkt.writeInt16(_timeNow());
        pkt.writeInt16(request.sentTime);
        pkt.writeInt8(0x10);
        pkt.writeInt16(4);
        pkt.writeInt8(3);
				pkt.writeInt8(request.sequence);
				pkt.writeInt8(1);
				pkt.writeInt8(1);
				
        break;
        
      //
      // Response: UNKNOWN
      //
      case types.UNKNOWN:
        //Do nothing
        break;
    }
    
    return pkt;
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
   * TODO: move to packet
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
   * TODO: move to packet
   */
  this.writeAddress = function(pkt, endpoint, isPublic) {
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
      for(k in ipParts)
        pkt.writeInt8(ipParts[k]);
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
    
    _rtmfp.encryptBuffer(pkt.buffer(), key, 4);
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
var types = {};
types.UNKNOWN = 0x00;
types.RENDEZVOUZ = 0x01;
types.RENDEZVOUZ_2 = 0x02;
types.HANDSHAKE_1 = 0x03;
types.HANDSHAKE_2 = 0x04;
types.KEEPALIVE = 0x05;
types.KEEPALIVE_RESPONSE = 0x06;
types.NET_CONNECTION_CLOSE = 0x07;
types.NET_CONNECTION_OPEN = 0x08;
types.NET_GROUP_JOIN = 0x09;
types.NET_GROUP_LEAVE = 0x0A;
types.NET_CONNECTION_ADDRESSES = 0x0B;
types.ACK = 0x0C;
types.NOT_ACK = 0x0D;
types.UNKNOWN_0x5e = 0x0E;
module.exports.REQUEST_TYPE = types;
module.exports.SYMETRIC_KEY = new Buffer('Adobe Systems 02');
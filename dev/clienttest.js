var dgram = require('dgram');
var RTMFP = require('../lib/rtmfp.js');
var NetConnection = require('../lib/net_connection');
var Arcus = require('../lib/arcus_node');
var Packet = require('../lib/packet.js');
//var cirrus = { address: '50.57.90.201', port: '1935' };
//var cirrus = { address: '50.56.33.168', port: '10001', url: 'p2p.rtmfp.net', app: '9f562071a62ee15bc91c8eec-4b461ed21d0f'};
//var cirrus = { address: '0.0.0.0', port: '19350', url: '0.0.0.0', app: 'vod/test'  };
var cirrus = { address: '192.168.73.129', port: '1935', url: 'some.awesome-service.org', app: '23502305u2a35u9jfih209th02h3g0000000000012' };
var arcus = new Arcus();
var nc = new NetConnection(arcus, 33554432);

var rtmfp = new RTMFP();
var cpkt = null;

_socket = dgram.createSocket('udp4', function(buffer, remoteInfo){
  
  var pkt = new Packet(buffer, buffer.length);
  
  var id = rtmfp.decodePacket(pkt);
  
  console.log(id);
  
  if(id != 0 && nc.state != NetConnection.HANDSHAKE){
    rtmfp.decryptPacket(pkt, nc.__p.decryptKey);
  } else {
    rtmfp.decryptPacket(pkt, RTMFP.SYMETRIC_KEY);
  }
  
  console.log('RECEIVED: ', pkt.toString());
  
  var msgs = rtmfp.readPacket(pkt);
  for(k in msgs){
    var msg = msgs[k];
    console.log('GOT MESSAGE ', msg.type);
    // FORWARD
    if(msg.type == RTMFP.FORWARD_REQUEST){
      for(k in msg.addresses){
        console.log('FORWARD ADDRESS: ', msg.addresses[k]);
      }
    }
    else if(msg.type == RTMFP.HANDSHAKE_RESPONSE){
      console.log('HANDSHAKE_RESPONSE: ', msg);
      // SEND KEY_REQUEST
      msg.type = RTMFP.KEY_REQUEST;
      
      msg.connectionId = nc.id;
      msg.publicKey = nc.publicKey;
      msg.certificate = nc.certificate;
      console.log('client pub key: ', msg.publicKey.length);
      var pkt = new Packet(new Buffer(200), 0).clear();

      rtmfp.writePacket(pkt, msg);
      console.log('KEY_REQUEST PACKET: ', pkt.toString());

      rtmfp.encryptPacket(pkt, RTMFP.SYMETRIC_KEY);
      rtmfp.encodePacket(pkt, 0);

      send(pkt, cirrus);
    }
    else if(msg.type == RTMFP.KEY_RESPONSE){
      console.log('KEY RESPONSE', msg, 'pub key length: ', msg.publicKey.length);
      
      nc.computeSharedSecret(msg.publicKey);
      
      var serverNonce = new Packet(new Buffer(msg.signature.length + msg.publicKey.length));
      serverNonce.writeBuffer(msg.signature);
      serverNonce.writeBuffer(msg.publicKey);
      
      //Working key generation
      nc.computeAsymetricKeys(serverNonce.buffer(), rtmfp.createClientNonce(nc.certificate));
      
      nc.__p.state = NetConnection.CONNECTING;
      
      msg.type = RTMFP.NET_CONNECTION_REQUEST;
      msg.url = 'rtmfp://' + cirrus.url + '/' + cirrus.app;
      msg.app = cirrus.app;
      msg.echoTime = msg.sentTime;
      
      cpkt = new Packet(255).clear();
      rtmfp.writePacket(cpkt, msg);
      console.log('NET CONNECTION REQUEST PACKET: ', cpkt.toString());
      
      nc.__p.clientConnectionId = msg.connectionId;
      
      rtmfp.encryptPacket(cpkt, nc.__p.encryptKey);
      rtmfp.encodePacket(cpkt, msg.connectionId);

      send(cpkt, cirrus);
      
    }
    else if(msg.type == RTMFP.NC_FAILED_REQUEST){
      var pkt = new Packet(32).clear();
      rtmfp.writePacket(pkt, {type: RTMFP.NC_FAILED_RESPONSE, flow: 2, stage: 2, echoTime: msg.sentTime});
      console.log('RECEIVED 0x5e, answering...', pkt.toString());
      
      rtmfp.encryptPacket(pkt, nc.__p.encryptKey);
      rtmfp.encodePacket(pkt, nc.__p.clientConnectionId);

      send(pkt, cirrus);
      
    }
  }
  
});
_socket.bind(57032);

var send = function(packet, endpoint) {
  _socket.send(packet.buffer(), 0, packet.size(), endpoint.port, endpoint.address, function (err, bytes) {
    if (err) {
      //TODO: Handle error and recover
      throw err;
    }
    console.log('Wrote ' + bytes + ' bytes to socket.');
  });
};


// SEND HANDSHAKE
var message = {};
message.type = RTMFP.HANDSHAKE_REQUEST;
message.url = 'rtmfp://' + cirrus.url + '/' + cirrus.app;
message.tag = Packet.randomBytes(16, new Buffer(16), 0);

var pkt = new Packet(new Buffer(64), 0).clear();

//Testing faulty handshake packet
var buf = new Buffer('0000000000000B6E4C30002A19180A72746D66703A2F2F78756761722E6E65743A313938352F1FE2AE6A5D9D24BC3C965EB985F4EDDD', 'hex');
var pkt = new Packet(buf, buf.length);

//rtmfp.writePacket(pkt, message);
console.log('URL LENGTH: ' + message.url.length);
console.log('HANDSHAKE PACKET: ', pkt.toString());

rtmfp.encryptPacket(pkt, RTMFP.SYMETRIC_KEY);
rtmfp.encodePacket(pkt, 0);

send(pkt, cirrus);

setTimeout(function(){
  //var buf = new Buffer('0000000000000D42513FE810003B8003010103004743020A0200012D10473A303130313031306331303065366336353734373336323663363936653731356636373732366637353730', 'hex');
  var buf = new Buffer('0000000000004D40547DEC10000403030201');
  var pkt = new Packet(buf, buf.length);
  rtmfp.encryptPacket(pkt, nc.__p.encryptKey);
  rtmfp.encodePacket(pkt, nc.__p.clientConnectionId);
  send(pkt, cirrus);      
}, 2000);
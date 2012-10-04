/**
 * ArcusNode PeerProxy
 */
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var dgram = require('dgram');
var Map = require('./map.js');
var Packet = require('./packet.js');
var RTMFP = require('./rtmfp.js');

var PeerProxy = module.exports = function(settings) {
  
  var _self = this;
  
  this.settings = {
  	port: 9000,
    logLevel: "warn"
  }

  //Merge Settings
  for(k in settings){
    this.settings[k] = settings[k];
  }

  // Create logger if not given
  if(settings.logger) {
    this.logger = settings.logger;
  } else {
    this.logger = require('./logger.js').createLogger(settings.logFile, settings.logLevel);
  }

  //
  this.socket = null;
  this._end2end = new Map();
  this.rtmfp = new RTMFP();
  
}

PeerProxy.prototype.listen = function(port, address) {
  var self = this;

	//Listen for connections
  //TODO: Support IPv6
  this.socket = dgram.createSocket('udp4', function(buffer, remoteInfo){
    // Pipe
    try {

      self.logger.debug('PeerProxy data from', remoteInfo)

      if(self.settings.logPackets === true){
        // Duplicate Buffer
        var packetBuffer = new Buffer(buffer.length);
        buffer.copy(packetBuffer, 0, 0, buffer.length)

        var pkt = new Packet(packetBuffer, buffer.length);
        var connectionId = self.rtmfp.decodePacket(pkt);
        
        if(connectionId == 0)
        {
          if(!self.rtmfp.decryptPacket(pkt, RTMFP.SYMETRIC_KEY))
          {
            self.logger.warn('PeerProxy handshake decryption failed!');
            return;
          }
          self.logger.debug('PeerProxy decrypted Handshake Packet: \n' + pkt.toString());

          var messages = self.rtmfp.readPacket(pkt);

          self.logger.debug('PeerProxy handshake messages: \n', messages);

        } 
        
      }
      
      var remoteEndpoint = remoteInfo.address + ':' + remoteInfo.port;
      if(self._end2end.has(remoteEndpoint)){
        var endpoint = self._end2end.get(remoteEndpoint);
        self.socket.send(buffer, 0, buffer.length, endpoint.port, endpoint.address, function (err, bytes) {
          if (err) {
            self.logger.error('PeerProxy send error: ', err.stack);
          }
      });
      }
    } catch(e) {
      self.logger.error('Peer proxy error: ' + e.stack);
    }
  });
  this.socket.bind(port || this.settings.port, address || (this.settings.address || null));
    
};

PeerProxy.prototype.addPair = function(endpoint1, endpoint2) {
  // Add to end2end
  this._end2end.add(endpoint1.address + ':' + endpoint1.port, endpoint2);
  this._end2end.add(endpoint2.address + ':' + endpoint2.port, endpoint1);
};

PeerProxy.prototype.removeEndpoint = function(endpoint) {
  var end = endpoint.address + ':' + endpoint.port;
  if(this._end2end.has(end)){
    this._end2end.remove(this._end2end.get(end));
    this._end2end.remove(end);
  }
};

PeerProxy.prototype.address = function() {
  if(!this._endpoint){
    this._endpoint = { address: this.settings.publicAddress || (this.socket != null ? this.socket.address().address : null), port: this.settings.port || (this.socket != null ? this.socket.address().port : null) };
  }
  return this._endpoint;
};

/**
 * Create an PeerProxy instance and return it
 */
PeerProxy.createServer = function(settings) {
  return new PeerProxy(settings);
};


//Inherit from EventEmitter
PeerProxy.prototype.__proto__ = EventEmitter.prototype;


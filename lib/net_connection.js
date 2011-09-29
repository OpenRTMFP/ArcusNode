 /**
 * NetConnection
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

var EventEmitter = require('events').EventEmitter;
var KeyExchange = require('../build/Release/keyexchange.node').KeyExchange;
var Packet = require('./packet.js');

/**
 * Represents a connection to ArcusNode
 * TODO: Make group join/leave more usable for events
 * TODO: provide NetConnection.call('commandName', callback, args...);
 * TODO: provide NetConnection.forward(endpoint);
 * TODO: provide NetConnection.connect() like in client
 * TODO: provide farId
 * TODO: make sure KeyExchange instance is destroyed on close to get rid of DH instance
 * TODO: document NetConnection API
 */
var NetConnection = module.exports = function(arcus, id, settings){
  //Check ArcusNode instance
  if(typeof arcus !== 'object'){
    throw new Error('A NetConnection depends on an ArcusNode instance that has to be given in the constuctor');
  }
  //Check id
  if(typeof id !== 'number'){
    throw new Error('A NetConnection need a numeric id that has to be given in the constuctor');
  }
  
  //PRIVATE ATTRIBUTES
  this.__p = {
    keyExchange: new KeyExchange(),
    keyPair: null,
    sharedSecret: null,
    certificate: null,
    state: NetConnection.HANDSHAKE,
    id: id,
    peerId: null,
    latency: 999999,
    lastMessage: null,
    groups: {},
    touchTime: Date.now(),
    keepalives: 0,
    //TODO: Cleanup Iterators in manage cycle
    addressIterators: {},
    authenticated: false,
    decryptKey: null,
    decryptKey: null,
    lastPacketTime: 0,
    cookie: null,
    clientConnectionId: 0,
    waiting: false,
    arcus: arcus
  };
  
  this.endpoints = [];
};

//Inherit from EventEmitter
NetConnection.prototype.__proto__ = EventEmitter.prototype;

/**
 * Get the certificate for that connection, if not yet existent, generate it
 */
NetConnection.prototype.__defineGetter__('certificate', function(){
  if(!this.__p.certificate){
    this.__p.certificate = Packet.randomBytes(64, new Buffer(64), 0);
  }
  return this.__p.certificate;
});

/**
 * Get the public key for DH key exchange, if not yet generated it will be
 *
 * @return {Buffer}
 */
NetConnection.prototype.__defineGetter__('publicKey', function(){
  if(!this.__p.keyPair){
    this.generateKeyPair();
  }
  return this.__p.keyPair[1];
});

/**
 * Get the private key for DH key exchange, if not yet generated it will be
 *
 * @return {Buffer}
 */
NetConnection.prototype.__defineGetter__('privateKey', function(){
  if(!this.__p.keyPair){
    this.__p.keyPair = _keyExchange.generateKeyPair();
  }
  return this.__p.keyPair[0];
});

/**
 * Generates a new private/public keypair for DH key Exchange and returns it
 *
 * @return {Array} [privateKey, publicKey]
 */
NetConnection.prototype.generateKeyPair = function(){
  return this.__p.keyPair = this.__p.keyExchange.generateKeyPair();
};

/**
 * Computes the shared secret for a public key from the other side stores and returns it
 *
 * @param {Buffer} publicKey
 * @return {Buffer} The shared secret
 */
NetConnection.prototype.computeSharedSecret = function(publicKey){
  if(!publicKey){
    throw new Error('Need public key to generate shared secret');
  }
  if(!this.__p.keyPair){
    this.generateKeyPair();
  }
  return this.__p.sharedSecret = this.__p.keyExchange.computeSharedSecret(publicKey);
};

/**
 * Computes the asymetric encryption/decryption keys, stores and returns them
 *
 * @param {Buffer} initiatorNonce
 * @param {Buffer} responderNonce
 * @return {Array} [decryptKey, encryptKey]
 */
NetConnection.prototype.computeAsymetricKeys = function(initiatorNonce, responderNonce){
  if(!this.__p.sharedSecret){
    throw new Error('Cannot compute keys, need public key from other side first (computeSharedSecret)');
  }
  if(!initiatorNonce || !responderNonce){
    throw new Error('Cannot compute keys without nonces');
  }
  var keys = this.__p.keyExchange.computeAsymetricKeys(this.__p.sharedSecret, initiatorNonce, responderNonce);
  this.__p.decryptKey = keys[0];
  this.__p.encryptKey = keys[1];
  return keys;
};

/**
 * The unique identifier within an ArcusNode instance
 *
 * @return {integer}
 */
NetConnection.prototype.__defineGetter__('id', function() {
  return this.__p.id;
});

/**
 * Keep the connection alive
 */
NetConnection.prototype.keepalive = function() {
  //TODO: Send server keepalive to client
  this.touch();
  return ++this.__p.keepalives;
};

/**
 * Gives the next address in from all endpoints, given a specific iterator.
 * Used to walk through endpoints on a rendezvouz message.
 * TODO: cleanup iterators
 * TODO: make private, used by arcus internally only
 */
NetConnection.prototype.nextAddress = function(tag){
  if(!this.__p.addressIterators[tag])
    this.__p.addressIterators[tag] = 0;
  if(this.__p.addressIterators[tag] == this.endpoints.length)
  {
    this.__p.addressIterators[tag] = 1;
  } else {
    this.__p.addressIterators[tag]++;
  }
  return this.endpoints[this.__p.addressIterators[tag] - 1];
};

/**
 * Gets latency of this specific connection
 *
 * @return {Integer} milliseconds
 */
NetConnection.prototype.__defineGetter__('latency', function(){
  return this.__p.latency;
});

/**
 * Gets the peer id for this connection, computed in the handshake
 *
 * @return {Buffer}
 */
NetConnection.prototype.__defineGetter__('peerId', function(){
  return this.__p.peerId;
});

/**
 * Gets the current connection state
 * 
 * @return {Integer} 
 */
NetConnection.prototype.__defineGetter__('state', function(){
  return this.__p.state;
});

/**
 * Set the current state of this connection,
 * checking the given state for correctness
 * and emitting the STATE_CHANGE event
 */
NetConnection.prototype.__defineSetter__('state', function(v){
  switch(v){
    case 0x00:
    case 0x01:
    case 0x02:
    case 0x03:
    case 0x04:
    case 0x05:
    case 0x06:
      this.__p.state = v;
      break;
    default:
      throw new Error('Unsupported state for NetConnection');
  }
  this.emit('state', v);
  return this.__p.state;
});

/**
 * Reset the timeout
 */
NetConnection.prototype.touch = function() {
  this.__p.touchTime = Date.now();
};

/**
 * When was the connection last touched?
 *
 * @return {Integer} Timestamp
 */
NetConnection.prototype.__defineGetter__('touched', function() {
  return this.__p.touchTime;
});

/**
 * Have this connection join a group, to keep track in which groups this connection is 
 * TODO: make publicly usable without flow
 */
NetConnection.prototype.join = function(flow, group) {
  this.__p.groups[flow] = group;
};

/**
 * Remove a group
 * TODO: make publicly usable without flow
 */
NetConnection.prototype.leave = function(flow) {
  var group = this.__p.groups[flow];
  delete this.__p.groups[flow];
  return group;
};

/**
 * Close this connection
 */
NetConnection.prototype.close = function() {
  if(this.state != NetConnection.CLOSING) {
    this.state = NetConnection.CLOSING;
    this.emit('close');
    for(k in this.__p.groups){
      this.__p.groups[k].remove(this.id);
    }
    console.log('nc close');
    this.__p.arcus.closeConnection(this);
  }
};

/**
 * Let the connection fail and send the fail message to the client
 * Emits the fail event.
 */
NetConnection.prototype.fail = function(){
  this.state = NetConnection.FAILED;
  this.proceed();
  this.__p.arcus.failConnection(this, this.__p.connectionMessage.flow);
  this.emit('fail');
};

/**
 * Accept the connection and trigger NetConnection.Connect.Success on the client.
 * Emits the accept event
 */
NetConnection.prototype.accept = function(description){
  this.state = NetConnection.ACCEPTED;
  this.proceed();
  this.__p.arcus.acceptConnection(this, description);
  this.emit('accept');
};

/**
 * Reject the connection and trigger NetConnection.Connect.Rejected on the client
 */
NetConnection.prototype.reject = function(description){
  this.state = NetConnection.REJECTED;
  this.proceed();
  this.__p.arcus.rejectConnection(this, description);
  this.emit('reject');
};

/**
 * Wait and do not handle anything until proceeding
 */
NetConnection.prototype.wait = function(){
  this.__p.waiting = true;
};

/**
 * Proceed with normal operation
 */
NetConnection.prototype.proceed = function(){
  this.__p.waiting = false;
};

/**
 * Is this connection waiting to be processed?
 *
 * @return {Boolean}
 */
NetConnection.prototype.__defineGetter__('waiting', function() {
  return this.__p.waiting;
});

/**
 * Set if this connection has been authenticated
 *
 * @param {Boolean} v
 */
NetConnection.prototype.__defineSetter__('authenticated', function(v) {
  return this.__p.authenticated = (v === true) ? true : false;
});

/**
 * Has this connection been authenticated?
 *
 * @return {Boolean}
 */
NetConnection.prototype.__defineGetter__('authenticated', function() {
  return this.__p.authenticated;
});

/**
 * Set if this connection has been authenticated
 *
 * @param {Boolean} v
 */
NetConnection.prototype.__defineSetter__('authenticated', function(v) {
  return this.__p.authenticated = (v === true) ? true : false;
});

//States
NetConnection.CLOSING = 0x00;
NetConnection.HANDSHAKE = 0x01;
NetConnection.CONNECTING = 0x02;
NetConnection.CONNECTED = 0x03;
NetConnection.FAILED = 0x04;
NetConnection.REJECTED = 0x05;
NetConnection.ACCEPTED = 0x06;

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

var ke = require('../build/default/keyexchange.node');

/**
 * Represents a connection to ArcusNode
 * TODO: Make group join/leave more usable for events
 * TODO: provide NetConnection.call('commandName', callback, args...);
 * TODO: provide NetConnection.forward(endpoint);
 * TODO: provide NetConnection.connect() like in client
 * TODO: provide farId
 * TODO: Make close really close the connection and send close message to other side
 */
module.exports = function(id, settings){

  var _keyExchange = new ke.KeyExchange(),
  _keyPair = null,
  _sharedSecret = null;
  
  var _state = module.exports.HANDSHAKE;
  var _id = id;
  var _peerId = null;
  var _latency = 999999;
  var _lastMessage = null;
  var _groups = {};
  var _touchTime = new Date().getTime();
  var _keepalives = 0;
  //TODO: Cleanup Iterators in manage cycle
  var _addressIterators = {};
  var _authenticated = false;
  this.addresses = [];
  
  /**
   * Get the public key for DH key exchange, if not yet generated it will be
   *
   * @return {Buffer}
   */
  this.getPublicKey = function(){
    if(!_keyPair){
      _keyPair = _keyExchange.generateKeyPair();
    }
    return _keyPair[1];
  };
  
  /**
   * Get the private key for DH key exchange, if not yet generated it will be
   *
   * @return {Buffer}
   */
  this.getPrivateKey = function(){
    if(!_keyPair){
      _keyPair = _keyExchange.generateKieyPair();
    }
    return _keyPair[0];
  };
  
  /**
   * Generates a new private/public keypair for DH key Exchange and returns it
   *
   * @return {Array} [privateKey, publicKey]
   */
  this.generateKeyPair = function(){
    return _keyPair = _keyExchange.generateKeyPair();
  };
  
  /**
   * Computes the shared secret for a public key from the other side stores and returns it
   *
   * @param {Buffer} publicKey
   * @return {Buffer} The shared secret
   */
  this.computeSharedSecret = function(publicKey){
    if(!_keyPair){
      throw new Error('No keypair, need to generate one first');
    }
    return _sharedSecret = _keyExchange.computeSharedSecret(publicKey);
  };
  
  /**
   * Computes the asymetric encryption/decryption keys, stores and returns them
   *
   * @param {Buffer} initiatorNonce
   * @param {Buffer} responderNonce
   * @return {Array} [decryptKey, encryptKey]
   */
  this.computeAsymetricKeys = function(initiatorNonce, responderNonce){
    if(!_sharedSecret){
      throw new Error('Cannot compute keys, need public key from other side first (computeSharedSecret)');
    }
    var keys = _keyExchange.computeAsymetricKeys(_sharedSecret, initiatorNonce, responderNonce);
    this.decryptKey = keys[0];
    this.encryptKey = keys[1];
    return keys;
  };
  
  this.id = function() {
    return _id;
  };
  
  /**
   * How often was this connection kept alive?
   *
   * @return {Integer}
   */
  this.keepalives = function() {
    return _keepalives;
  };
  
  /**
   * Keep the connection alive
   */
  this.keepalive = function() {
    this.touch();
    return ++_keepalives;
  };
  
  /**
   * Gives the next address in from all addresses, given a specific iterator.
   * Used to walk through addresses on a rendezvouz message.
   * TODO: cleanup iterators
   */
  this.nextAddress = function(tag){
    if(!_addressIterators[tag])
      _addressIterators[tag] = 0;
    if(_addressIterators[tag] == this.addresses.length)
    {
      _addressIterators[tag] = 1;
    } else {
      _addressIterators[tag]++;
    }
    return this.addresses[_addressIterators[tag] - 1];
  };
  
  /**
   * Gets and sets latency of this specific connection
   */
  this.latency = function(latency){
    if(latency)
      _latency = latency;
    return _latency;
  };
  
  /**
   * Gets and sets the peer id, computed in the handshake
   */
  this.peerId = function(peerId){
    if(peerId)
      _peerId = peerId;
    return _peerId;
  };
  
  /**
   * Gets and sets the current connection state
   */
  this.state = function(state){
    if(state)
      _state = state;
    return _state
  };
  
  /**
   * Reset the timeout
   */
  this.touch = function() {
    _touchTime = new Date().getTime();
  };
  
  /**
   * When was the connection last touched?
   */
  this.touched = function() {
    return _touchTime;
  };
  
  /**
   * The last message sent over this connection without an received ACK
   */
  this.lastMessage = function(lastMessage){
    if(lastMessage !== undefined) {
      _lastMessage = lastMessage;
    }
    return _lastMessage;
  };
  
  /**
   * Have this connection join a group, to keep track in which groups this connection is 
   */
  this.join = function(sequence, group) {
    _groups[sequence] = group;
  };
  
  /**
   * Remove a group
   */
  this.leave = function(sequence) {
    var group = _groups[sequence];
    delete _groups[sequence];
    return group;
  };
  
  this.close = function() {
    _state = module.exports.CLOSING;
    for(k in _groups){
      _groups[k].remove(_id);
    }
  };
  
  /**
   * Has this connection been authenticated?
   */
  this.authenticated = function(v) {
    if(v) {
      _authenticated = v;
    }
    return _authenticated;
  };
};

//States
module.exports.CLOSING = 0x00;
module.exports.HANDSHAKE = 0x01;
module.exports.CONNECTING = 0x02;
module.exports.CONNECTED = 0x03;

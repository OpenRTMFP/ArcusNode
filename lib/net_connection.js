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

/**
 * Represents a connection to ArcusNode
 * TODO: Make group join/leave more usable for events
 */
module.exports = function(id, settings){
  var _state = module.exports.HANDSHAKE;
  var _id = id;
  var _peerId = null;
  var _latency = 999999;
  var _lastRequest = null;
  var _groups = {};
  var _touchTime = new Date().getTime();
  var _keepalives = 0;
  //TODO: Cleanup Iterators in manage cycle
  var _addressIterators = {};
  var _authenticated = false;
  this.addresses = [];
  
  this.id = function() {
    return _id;
  };
  
  /**
   * How often was this connection kept alive?
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
   * Used to walk through addresses on a rendezvouz request.
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
   * The latency of this specific connection
   */
  this.latency = function(latency){
    if(latency)
      _latency = latency;
    return _latency;
  };
  
  /**
   * The peer id, computed in the handshake
   */
  this.peerId = function(peerId){
    if(peerId)
      _peerId = peerId;
    return _peerId;
  };
  
  /**
   * The current connection state
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
   * The last request sent over this connection without an received ACK
   */
  this.lastRequest = function(lastRequest){
    if(lastRequest !== undefined)
      _lastRequest = lastRequest;
    return _lastRequest;
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
    for(k in _groups)
      _groups[k].remove(_id);
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

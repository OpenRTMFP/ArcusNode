/**
 * NetGroup
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
 * Represents a group of connection in ArcusNode (Client NetGroup)
 * TODO: Make group join/leave more usable for events
 */
module.exports = function(id, settings){
  if(!id)
    throw new Error('NetGroup needs an id.');

  var _id = id;
  var _size = 0;
  var _connections = {};
  var _touchTime = new Date().getTime();
  
  this.id = function() {
    return _id;
  };
  
  /**
   * Add a NetConnection to this group
   */
  this.add = function(nc) {
    if(!_connections[nc.id()])
      _size++;
    _connections[nc.id()] = nc;
  };
  
  /**
   * Remove a NetConnection from this group
   */
  this.remove = function(ncId) {
    if(_connections[ncId]){
      _size--;
    }
    delete _connections[ncId];
  };
  
  /**
   * How many members does this group have?
   */
  this.size = function() {
    return _size;
  };
  
  /**
   * Reset the group timeout, after which the group gets deleted
   */
  this.touch = function() {
    _touchTime = new Date().getTime();
  };
  
  /**
   * When was this group last touched? 
   */
  this.touched = function() {
    return _touchTime;
  };
  
  /**
   * The connections in this group (the members)
   */
  this.connections = function() {
    return _connections;
  };
  
  /**
   * Returns the connections ordered by their latency
   */
  this.fastest = function(excludeNc) {
    var sorted = [];
    for(k in _connections){
      if(_connections[k] != excludeNc)
        sorted.push(_connections[k]);
    }
    sorted.sort(function(a, b) {
      return (a.latency() < b.latency());
    });
    return sorted;
  };
};

//States
module.exports.CLOSING = 0x00;
module.exports.HANDSHAKE = 0x01;
module.exports.CONNECTING = 0x02;
module.exports.CONNECTED = 0x03;

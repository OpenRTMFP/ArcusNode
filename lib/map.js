/**
 * Every good System has its own Map implementation :D
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
 * A very basic Map implementation
 */
var Map = module.exports = function(){
  this.wipe();
};

/**
 * Wipe out the map
 */
Map.prototype.wipe = function() {
  this.map = {};
  this.keys = [];
  this._length = 0;
};

/**
 * Add a key value pair
 *
 * @param {mixed} key
 * @param {mixed} value
 * @return {Map} for chaining
 */
Map.prototype.add = function(key, value){
  if(!this.has(key)){
    this._length++;
    this.keys.push(key);
  }
  this.map[key] = value;
  return this;
};

/**
 * Remove a Map entry with the given key
 *
 * @param {mixed} key
 * @return {Boolean} true if entry was removed, false otherwise
 */
Map.prototype.remove = function(key){
  if(typeof this.map[key] !== 'undefined'){
    this._length--;
    delete this.map[key];
    this.keys.splice(this.keys.indexOf(key), 1);
    return true;
  }
  return false;
};

/**
 * Get the value for the given key
 *
 * @param {mixed} key
 * @return {mixed} the value for the key
 */
Map.prototype.get = function(key){
  return this.map[key];
};

/**
 * Get the value for a given position
 *
 * @param {number} position
 * @return {mixed} the value for the position
 */
Map.prototype.getAt = function(pos){
  return this.map[this.keys[pos]];
};

/**
 * Check if the given key is available in the Map and return exact boolean
 *
 * @param {mixed} key
 * @return {Boolean} 
 */
Map.prototype.has = function(key){
  return typeof this.map[key] !== 'undefined';
};

/**
 * Iterate over Map entries, invoking the give function for each entry
 *
 * @param {Function} fn Will get two arguments "key" and "value"
 */
Map.prototype.forEach = function(fn, context){
  for(var i = 0; i < this.keys.length; i++) {
    if(typeof this.keys[i] !== 'undefined'){
      fn.call(context, this.keys[i], this.map[this.keys[i]]);
    }
  }
};

/**
 * Get the number of key/value pairs in this Map
 */
Map.prototype.__defineGetter__('length', function(){
  return this._length;
});

/**
 * Get a string representation of the key/value pairs in this map
 */
Map.prototype.toString = function() {
  return 'Map Object (' + this.keys.length + ') [' + this.keys.join(', ') + ']';
};
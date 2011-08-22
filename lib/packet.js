/**
 * Packet
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

var rtmfp = require('../build/default/rtmfp.node');

/**
 * The Packet uses a node Buffer to represent a UDP Packet
 * and provides an API to work with it.
 * All write functionality returns the packet itself for method chaining.
 *
 * @param {Buffer||Integer} arguments[0] The Buffer the packet will work on or a size for a Buffer that will be created
 * @param {integer} size (optional) Can be smaller than the buffer length, tells how many bytes have been written to the packet already
 */
module.exports = function(){
  var _buffer = null, _pos = 0, _bytesWritten = 0;
  
  //buffer [, size]
  if(arguments[0] instanceof Buffer){
      _buffer = arguments[0];
      if(typeof arguments[1] === 'number'){
        if(arguments[1] > _buffer.length){
          throw new Error('Size cannot initially be larger than the buffer');
        }
        _bytesWritten = arguments[1];
      }
  } 
  //size
  else if(typeof arguments[0] === 'number'){
    _buffer = new Buffer(arguments[0]);
    _buffer.fill(0);
  } else {
    throw new Error('Invalid arguments for Packet');
  }
  
  var _rtmfp = new rtmfp.RTMFP();
  
  /**
   * Checks if the buffer is big enough to take length,
   * otherwise doubles the buffer size.
   *
   * @param {integer} length Will be checked if the next write step would be over the buffer length
   */
  var _ensureSize = function(length) {
    if(_pos + length > _buffer.length){
      var newBuffer = new Buffer(_buffer.length * 2);
      _buffer.copy(newBuffer, 0, 0, _buffer.length);
      _buffer = newBuffer;
      _ensureSize(length);
    }
  };

//
// WRITING
//
  
  /**
   * Writes an array with bytes to the packets Buffer from the current position
   *
   * @param {Array} byteArray A simple array with uint8 values ([0x00, 0xFF])
   * @return {Packet}
   */
  this.writeBytes = function(byteArray){
    _ensureSize(byteArray.length);
    for(i = 0; i < byteArray.length; i++) {
      _buffer[_pos++] = byteArray[i];
    }
    if(_pos > _bytesWritten) {
      _bytesWritten = _pos;
    }
    return this;
  };
  
  /**
   * Write a 4-byte integer
   *
   * @param {integer} integer The value to write to the packet
   * @return {Packet}
   */
  this.writeInt32 = function(integer) {
    _ensureSize(4);
    _buffer[_pos++] = (integer >>> 24);
    _buffer[_pos++] = (integer >>> 16);
    _buffer[_pos++] = (integer >>> 8);
    _buffer[_pos++] = integer;
    if(_pos > _bytesWritten)
      _bytesWritten = _pos;
    return this;
  };
  
  /**
   * Write a 2-byte integer
   *
   * @param {integer} integer The value to write to the packet
   * @return {Packet}
   */
  this.writeInt16 = function(integer) {
    _ensureSize(2);
    _buffer[_pos++] = (integer >>> 8);
    _buffer[_pos++] = integer;
    if(_pos > _bytesWritten)
      _bytesWritten = _pos;
    return this;
  };
  
  /**
   * Write a 1-byte integer
   *
   * @param {integer} integer The value to write to the packet
   * @return {Packet}
   */
  this.writeInt8 = function(integer) {
    _ensureSize(1);
    _buffer[_pos++] = integer;
    if(_pos > _bytesWritten)
      _bytesWritten = _pos;
    return this;
  };
  
  /**
   * Writes random bytes to the buffer from current pos to pos + length 
   *
   * @param {integer} length How many bytes should be written randomly
   * @return {Packet}
   */
  this.writeRandom = function(length){
    _ensureSize(length);
    randomBytes(length, _buffer, _pos);
    _pos += length;
    if(_pos > _bytesWritten)
      _bytesWritten = _pos;
    return this;
  }
  
  /**
   * Writes the bytes from another buffer to the packets Buffer
   *
   * @param {Buffer} buffer The buffer to write the bytes from
   * @return {Packet}
   */
  this.writeBuffer = function(buffer){
    _ensureSize(buffer.length);
    buffer.copy(_buffer, _pos);
    _pos += buffer.length;
    if(_pos > _bytesWritten)
      _bytesWritten = _pos;
    return this;
  }
  
  /**
   * Writes a String to the packets buffer
   *
   * @param {String} str Will beconverted to a buffer and written 
   * @return {Packet}
   */
  this.writeString = function(str){
    this.writeBuffer(new Buffer(str));
  };
  
  /**
   * Writes an 8-byte encoded double value
   *
   * @param {Number} number The value that should be written to the packet
   * @return {Packet}
   */
  this.writeDouble = function(number) {
    _ensureSize(8);
    _buffer.writeDouble(number, _pos, 'big');
    _pos += 8;
    if(_pos > _bytesWritten)
      _bytesWritten = _pos;
    return this;
  };
  
  /**
   * Writes an AMF U29 encoded integer to the packet 
   *
   * @param {Integer}
   * @return {packet}
   */
  this.writeU29 = function(integer) {
    _ensureSize(8);
    _pos += _rtmfp.writeU29(_buffer, integer, _pos);
    return this;
  };
  
  /**
   * Clears the packets buffer with buffer.fill(0);
   *
   * @return {Packet}
   */
  this.clear = function(){
    _buffer.fill(0);
    //Allow Chaining
    return this;
  };
  
//
// READING
//
  
  /**
   * Reads the given length of bytes from the packets Buffer
   * and optionally (if the copy argument is true) creates a real copy of the Buffer
   *
   * @param {Integer} length
   * @param {Boolean} copy
   * @return {Buffer}
   */
  this.readBytes = function(length, copy){
    if(copy){
      var bufCopy = new Buffer(length);
      _buffer.copy(bufCopy, 0, _pos, (_pos += length));
      return bufCopy;
    } else {
      return _buffer.slice(_pos, (_pos += length));
    }
  };
  
  /**
   * Reads a 4-byte integer from the packet
   *
   * @return {Integer}
   */
  this.readInt32 = function() {
    return (_buffer[_pos++] << 24) | (_buffer[_pos++] << 16) | (_buffer[_pos++] << 8) | _buffer[_pos++];    
  };
  
  /**
   * Reads a 2-byte integer from the packet
   *
   * @return {Integer}
   */
  this.readInt16 = function() {
    return (_buffer[_pos++] << 8) | _buffer[_pos++];
  };
  
  /**
   * Reads a 1-byte integer from the packet
   *
   * @return {Integer}
   */
  this.readInt8 = function() {
    return _buffer[_pos++];
  };
  
  /**
   * Reads 8-byte encoded double value
   *
   * @return {Double}
   */
  this.readDouble = function() {
    var value = _buffer.readDouble(_pos, 'big');
    _pos += 8;
    return value;
  };
  
  /**
   * Reads a AMF U29 encoded integer from the packet 
   *
   * @return {Integer}
   */
  this.readU29 = function() {
    var value = _rtmfp.readU29(_buffer, _pos);
    _pos = value[1] + 1;
    return value[0];    
  };
  
  /**
   * Returns the next byte in the packet without changing the current position in the Buffer
   *
   * @return {Byte}
   */
  this.peek = function() {
    return _buffer[_pos];
  };
  
//
// MISC
//

  /**
   * Moves the position forward
   *
   * @param {Integer} skip
   * @return {Integer} The new position
   */
  this.skip = function(skip) {
    return _pos += skip;
  };
  
  /**
   * How much bytes are still available from the current read/write position to the end?
   *
   * @return {Integer}
   */
  this.available = function(){
    return _bytesWritten - _pos;
  };
  
  /**
   * Sets and returns the current read/write position
   *
   * @param {Integer} newPostion
   * @return {Integer} The current position
   */
  this.pos = function(newPosition){
    if(newPosition >= 0)
      _pos = newPosition;
    return _pos;
  };
  
  /**
   * Gives the real size of the packet, despite of the Buffer size
   *
   * @return {Integer}
   */
  this.size = function(){
    return _bytesWritten;
  };
  
  /**
   * Makes the packet internal Buffer availible
   * (for example to send it)
   *
   * @return {Buffer}
   */
  this.buffer = function(){
    return _buffer;
  };
  
  /**
   * Gives a String representation in Hex of this packet
   *
   * @return {String}
   */
  this.toString = function(){
    return 'Size: ' + _bytesWritten + '\n' + prettyBuffer(_buffer, 0, _bytesWritten);
  };
  
};

var _string_256 =
[
 "00", "01", "02", "03", "04", "05", "06", "07", "08", "09", "0A", "0B", "0C", "0D", "0E", "0F",
 "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "1A", "1B", "1C", "1D", "1E", "1F",
 "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "2A", "2B", "2C", "2D", "2E", "2F",
 "30", "31", "32", "33", "34", "35", "36", "37", "38", "39", "3A", "3B", "3C", "3D", "3E", "3F",
 "40", "41", "42", "43", "44", "45", "46", "47", "48", "49", "4A", "4B", "4C", "4D", "4E", "4F",
 "50", "51", "52", "53", "54", "55", "56", "57", "58", "59", "5A", "5B", "5C", "5D", "5E", "5F",
 "60", "61", "62", "63", "64", "65", "66", "67", "68", "69", "6A", "6B", "6C", "6D", "6E", "6F",
 "70", "71", "72", "73", "74", "75", "76", "77", "78", "79", "7A", "7B", "7C", "7D", "7E", "7F",
 "80", "81", "82", "83", "84", "85", "86", "87", "88", "89", "8A", "8B", "8C", "8D", "8E", "8F",
 "90", "91", "92", "93", "94", "95", "96", "97", "98", "99", "9A", "9B", "9C", "9D", "9E", "9F",
 "A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "AA", "AB", "AC", "AD", "AE", "AF",
 "B0", "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "BA", "BB", "BC", "BD", "BE", "BF",
 "C0", "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "CA", "CB", "CC", "CD", "CE", "CF",
 "D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "DA", "DB", "DC", "DD", "DE", "DF",
 "E0", "E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8", "E9", "EA", "EB", "EC", "ED", "EE", "EF",
 "F0", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "FA", "FB", "FC", "FD", "FE", "FF"
];
  
/**
 * A static Packet function to format a node Buffer as a Hex String representation
 * + normal string representation of the bytes
 *
 * @param {Buffer} buffer
 * @param {Integer} offset
 * @param {Integer} length
 * @return {String}
 */
var prettyBuffer = module.exports.prettyBuffer = function(buffer, offset, length){
  var str = '', ascii = '', asciiChar = '', c = 0, p = (offset) ? offset : 0, e = (length) ? length + p : buffer.length;
  while(p < e){
    str += _string_256[buffer[p]] + ' ';
    asciiChar = buffer.toString('utf8', p, p + 1);
    ascii += 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890:/-_'.indexOf(asciiChar) == -1 ? '.' : asciiChar;
    p++;
    c++;
    if(c == 16 || p == buffer.length){
      for(c; c < 16; c++){
        str += '   ';
      }
      str += ascii + "\n";
      c = 0;
      ascii = '';
    }
  }
  return str;
}

/**
 * Generates random bytes and writes them to the given buffer, from offset to length.
 * If no buffer is given, a new one is created.
 *
 * @param {Integer} length
 * @param {Buffer} buffer
 * @param {Integer} offset
 */
var randomBytes = module.exports.randomBytes = function(length, buffer, offset){
  if(!buffer)
    buffer = new Buffer(length);
  if(!offset)
    offset = 0;
  for(i = 0; i < length; i++){
    buffer[i + offset] = Math.round(Math.random() * 255);
  }
  return buffer;
}
/**
 * ArcusEvent
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
 * An ArcusNode Event
 */
function ArcusEvent(type, arcus, nc, request) {
  
  var _arcus = arcus, 
  _nc = nc, 
  _type = type, 
  _request = request, 
  _finished = false,
  _time = Date.now();
  
  //Getter for the ArcusNode instance this ArcusEvent is coming from
  this.arcus = function() {
    return _arcus;
  };
  
  //The request related to this event
  this.request = function() {
    return _request;
  };

  //Getter for the NetConnection instance this ArcusEvent is related to
  this.nc = function() {
    return _nc;
  };

  //Getter for the ArcusEvent type (string)
  this.type = function() {
    return _type;
  };
  
  this.finished = function() {
    return _finished;
  };
  
  this.creationTime = function() {
    return _time;
  };
  
  /**
   * Finishes the ArcusEvent in an async case with the given data
   * TODO: Maybe "continue" would be a better name?
   */
  this.finish = function() {
    if(_finished === true) {
      throw new Error('Arcus Event was finished before already.');
    }
    _finished = true;
    this.finishData = (arguments.length > 0) ? arguments : undefined;
    (function(arcus, evt){
      process.nextTick(function() {
        arcus.finishEvent.call(arcus, evt);
      });
    })(_arcus, this);
  };
};
module.exports = ArcusEvent;

//Getter for the ArcusEvent data, 
//which can be a request or some other data, depending on the event type
ArcusEvent.prototype.data = null;
ArcusEvent.prototype.command = null;

//Event Type pseudo constants
ArcusEvent.HANDSHAKE = 0x00;
ArcusEvent.CONNECT = 0x01;
ArcusEvent.DISCONNECT = 0x02;
ArcusEvent.COMMAND = 0x03;

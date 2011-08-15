/**
 * Helper - utilities for ArcusNode (to not conflict with nodes util module)
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
 * Formats a number with lapsed seconds to a string
 *
 * @param {Integer} seconds The time lapsed in seconds to be formated
 * @return {String} "[%i years][%i months][%i days][%i hours][%i minutes] %i seconds"
 */
var formatLapsed = module.exports.formatLapsed = function(seconds){
  var str = '';
  var interval = Math.floor(seconds / 31536000);
  if (interval >= 1) {
      str += interval + " years ";
      seconds = seconds % 31536000;
  }
  interval = Math.floor(seconds / 2592000);
  if (interval >= 1) {
      str += interval + " months ";
      seconds = seconds % 2592000;
  }
  interval = Math.floor(seconds / 86400);
  if (interval >= 1) {
      str += interval + " days ";
      seconds = seconds % 86400;
  }
  interval = Math.floor(seconds / 3600);
  if (interval >= 1) {
      str += interval + " hours ";
      seconds = seconds % 3600;
  }
  interval = Math.floor(seconds / 60);
  if (interval >= 1) {
      str += interval + " minutes ";
      seconds = seconds % 60;
  }
  return str += Math.floor(seconds) + " seconds";
};
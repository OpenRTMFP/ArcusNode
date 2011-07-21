# wscript
#  
# Copyright 2011 OpenRTMFP
# 
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# 
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License received along this program for more
# details (or else see http://www.gnu.org/licenses/).
#
# Author: arcusdev <arcus.node@gmail.com>
#
# This file is a part of ArcusNode.
 
import os

srcdir = '.'
blddir = './build'
VERSION = '0.0.2'
 
def set_options(opt):
  opt.tool_options('compiler_cxx')
 
def configure(conf):
  conf.check_tool('compiler_cxx')
  conf.check_tool('node_addon')
  
def build(bld):
  rtmfp = bld.new_task_gen('cxx', 'shlib', 'node_addon')
  
  if sys.platform.startswith("cygwin"):
    rtmfp.lib = 'crypto';
  
  rtmfp.cxxflags = ["-g", "-D_FILE_OFFSET_BITS=64", "-D_LARGEFILE_SOURCE", "-Wall", "-L/usr/lib", "-lssl"]
  rtmfp.chmod = 0755
  rtmfp.target = 'rtmfp'
  rtmfp.source = 'src/rtmfp.cc'
  
def clean(opt):
  if os.path.exists(blddir + '/default/rtmfp.node'): os.unlink(blddir + '/default/rtmfp.node')
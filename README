# ArcusNode
#### A RTMFP Rendevouz Server For Peer Assisted Networking With Adobe Flash

Author: arcusdev [arcus.node@gmail.com]
License: [GPL](http://www.gnu.org/licenses/) 

## Description
ArcusNode is an offspring of [Cumulus](http://github.com/OpenRTMFP/Cumulus), a standalone C++ implementation of the _RTMFP Protocol_ and much more. ArcusNode aims to assist P2P networking with ease of extendability due to Javascript glue.

## Installation
To use ArcusNode as a service, get it from [github](http://github.com/OpenRTMFP/ArcusNode) and run:
<pre>
$> node-waf configure build
$> node service.js
</pre>
You then should see:
<pre>
Starting up ArcusNode RTMFP Service
ArcusNode RTMFP Service running at port 1935
</pre>
1935 is the default port for RTMFP communication.

## Usage
As you can see in the service.js, it is very easy to use ArcusNode in your own project.
<pre>
var ArcusNode = require('./lib/arcus_node.js');
var arcusService = new ArcusNode();
arcusService.run();
</pre>
ArcusNode already takes a settings object in the constructor, through which later on many customization will be possible, like specifying an authentication callback which gets a username/id and password (can also be a session id), so you can do use your own authentication implementation easily.

## Roadmap
To reach version 0.1:
* Add command line arguments
* Stabilize the rendezvouz part
* Implement management cycle 
* Add user authentication through a callback method, given to ArcusNode as a setting
* Add support for RPCs which can be extended easily with javascript functions
* Add testing scripts and a Flash testing project

## Development
If you have ideas, suggestions, bugfixes or just want to yell a little at the author,
feel free to contact arcus.node@gmail.com


&copy; Copyright 2011 OpenRTMFP

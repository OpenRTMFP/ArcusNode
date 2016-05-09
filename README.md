If anyone is still interested in using this project, I am considering a major open source overhaul.
Please poke me at arcus.node@gmail.com if you are interested...

# ArcusNode
#### A RTMFP Rendevouz Server For Peer Assisted Networking With Adobe Flash on NodeJS
ArcusNode aims to assist P2P networking with ease of extendability due to Javascript glue with NodeJS.
ArcusNode is a standalone RTMFP implementation.
We want to thank [Cumulus](http://github.com/OpenRTMFP/Cumulus), a standalone C++ implementation of the _RTMFP Protocol_ and much more.

Author: arcusdev [arcus.node@gmail.com]  
License: [GPL](http://www.gnu.org/licenses/) 

## Issues
If you have an **issue** with ArcusNode, please use the Github issue tracker!


## Status
ArcusNode is still under heavy development and much work remains to be done. 
It covers the following features already:

* P2P Rendezvouz service
* NetGroups
* Remote Methods / Commands
* Authentication
* Plugins


## Build & Installation
ArcusNode runs on Node v0.5.5 and higher. To use ArcusNode as a service, get it from [github](http://github.com/OpenRTMFP/ArcusNode) and run:
<pre>
$> node-waf configure build
$> node service.js
</pre>
You then should see something like:
<pre>
Starting up ArcusNode RTMFP Service.
Copyright (C) 2011 OpenRTMFP
This program comes with ABSOLUTELY NO WARRANTY.
This is free software, and you are welcome to redistribute it under certain conditions.
(For usage help type "node service.js -h")
ArcusNode RTMFP Service running at 0.0.0.0:1935
</pre>
1935 is the default port for RTMFP communication and you should now be able to connect to the server, create groups and get peers connected.

#### Cygwin
If you run into problems building node on Cygwin, checkout _https://github.com/joyent/node/wiki/Building-node.js-on-Cygwin-(Windows)_.
If you consider using rebase, use both _./rebaseall_ and _./perlrebase_.

## Usage
### Basic
As you can see in the service.js, it is very easy to use ArcusNode in your own project.
<pre>
var ArcusNode = require('./lib/arcus_node.js');
var arcusService = new ArcusNode();
arcusService.run();
</pre>

### Customization
ArcusNode uses a mixture of Events and registered command callbacks. Events behave like known Node core events.
Commands are called by a connected client through its NetConnection#call and can be registered on ArcusNode. 
Commands on the server behave almost exactly the same as described in the Flash Documentation,
except that ArcusNode command callbacks always get the NetConnection which called the command as first argument, then the arguments from the Client. 

### Events

At this moment, ArcusNode emits the following events:

* start
* stop
* handshake
* connect
* disconnect
* command

ArcusNode uses the Node [EventEmitter](http://nodejs.org/docs/v0.5.3/api/events.html#events.EventEmitter) API

Example for a connect event listener:
<pre>
var ArcusNode = require('./lib/arcus_node.js');
var arcusService = new ArcusNode();

arcusService.on('connect', function(nc, obj){
  console.log('Received a connection request for Connection ' + nc.id + ' with the properties', obj);
});

arcusService.run();
</pre>


### Commands
[todo]

Example for a command Client side:
<pre>
var responder:Responder = new Responder(function(response) {
  trace(response.what); //-> 'ArcusNode rocks!'
});
connection.call('sayWhat', responder, { name: 'ArcusNode' });
</pre>

Example for a command Server side:
<pre>
arcusService.onCommand('sayWhat', function(nc, obj){
  return { what: obj.name + ' rocks!' };
});
</pre>

### ArcusNode Settings

The ArcusNode constructor takes a settings object with the following attributes:

<pre>
.port
  Type: Integer
  Default: 1935
  The port that ArcusNode will listen for UDP connections.
  
.address
  Type: String
  Default: ''
  ArcusNode can be run on a specific interface if wanted.
  
.logLevel
  Type: String
  Default: 'warn'
  Can be one of ['fatal', 'error', 'warn', 'info', 'debug'].
  
.logFile:
  Type: String, path
  Default: ''
  If a path for a log file is specified, all logging will be written to that file.

.manageInterval 
  Type: Integer, seconds 
  default: 60 
  The interval for the management cycle to do cleanup

.connectionTimeout 
  Type: Integer, milliseconds 
  Default: 120000 
  The timeout for a NetConnection. The connections is dropped after the NetConnection was unused for that amount of time. 

.groupTimeout
  Type: Integer, milliseconds
  Default: 360000
  The timeout for a NetGroup. The group is dropped afer there was no interaction for that amount of time.

.serverKeepalive
  Type: Integer, milliseconds
  Default: 60000
  The timeout before the server sends a keepalive command to the client.
  Should be less then connectionTimeout.

.clientKeepalive
  Type: Integer, milliseconds
  Default: 60000
  Will tell the client in what interval it should send keepalive messages

.maxKeepalives
  Type: Integer
  Default: 3
  How often to max keepalive the connection before dropping it.
</pre>

## Roadmap
To reach version 0.1:

* Add testing scripts and a Flash testing project
* Complete AMF reading/writing (70%)

## Development
If you have ideas, suggestions, bugfixes or just want to yell a little at the author,
feel free to contact arcus.node@gmail.com


&copy; Copyright 2011 OpenRTMFP

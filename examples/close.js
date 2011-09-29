/**
 * Close a NetConnection
 */
var ArcusNode = require('../lib/arcus_node.js');

//Create a new ArcusNode instance
var arc = ArcusNode.createServer();

arc.on('connect', function(nc, options, username, password){
  // Close the connection after 30 seconds
  setTimeout(function() {
  	nc.close();
  }, 3000);
});

//Start the server
arc.run();
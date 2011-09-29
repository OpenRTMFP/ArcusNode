/**
 * Close a NetConnection
 */
var ArcusNode = require('../lib/arcus_node.js');

//Create a new ArcusNode instance
var arc = ArcusNode.createServer();

arc.on('connect', function(nc, options, username, password){
	nc.on('close', function(){
    console.log('Connection ' + nc.id + ' was closed.');
  });

  // Close the connection after 30 seconds
  setTimeout(function() {
  	nc.close(function(success){
     if(success){
       console.log('Connection close attempt successful.');
     } else {
       console.log('ERROR: Connection could not be closed.');
     }
    });
  }, 3000);
});

//Start the server
arc.run();
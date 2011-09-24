# Examples
#### using ArcusNode

## auth.js
Here you find an example for a possible user authentication,
failing the connection if the username and password are not given,
rejecting the connection if the given credentials do not match
and finally accepting the connection if the credentials are ok.

To test this example, use the FLDev Flash project from the repository.
With it you can specify comma separated arguments for a NetConnection.
Run the auth example with 
<pre>
$> node example/auth.js
</pre>
and then try connecting to the ip you are running the example on.
You should the a message like _Connection 4 status: NetConnection.Connect.Failed_ in the bottom console.
Now try giving the connection the arguments _"name,password"_ and you should be successfully connected.
Try specifiying wrong credentials and you should see a _NetConnection.Connect.Rejected_ message.
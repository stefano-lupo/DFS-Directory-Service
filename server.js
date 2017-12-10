import crypto from 'crypto';
import express from 'express';
import mongoose from 'mongoose';
import bodyParser from 'body-parser';
import morgan from 'morgan';
import moment from 'moment';

// Import Controllers
import ClientController from './controllers/ClientController';

// Create Server
const app = express();
app.use(bodyParser.urlencoded({extended: true}));   // Parses application/x-www-form-urlencoded for req.body
app.use(bodyParser.json());                         // Parses application/json for req.body
app.use(morgan('dev'));

// Initialize .env
require('dotenv').config();

// Make encryption parameters accessible
const encryption = {
  algorithm: process.env.SYMMETRIC_ENCRYPTION,
  plainEncoding: process.env.PLAIN_ENCODING,
  encryptedEncoding: process.env.ENCRYPTED_ENCODING,
  serverKey: process.env.SERVER_KEY
};


// Initialize the DB
const dbURL = "mongodb://localhost/dfs_directoryService";
mongoose.connect(dbURL);
const db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', function() {
  console.log("Connected to Database");
});



// Middleware to authenticate / decrypt incoming requests
const authenticator = (req, res, next) => {

  // Ensure auth ticket exists
  const { authorization } = req.headers;
  if(!authorization) {
    return res.status(401).send({message: `No authorization key provided`});
  }

  try {
    // Decrypt auth ticket with server's private key
    const ticket = decrypt(authorization);

    // Parse the ticket from the decrypted string
    let { _id, expires, sessionKey } = JSON.parse(ticket);
    expires = moment(expires);


    // Ensure the ticket is in date
    if(moment().isAfter(expires)) {
      console.log(`Ticket expired on ${expires.format()}`);
      return res.status(401).send({message: `Authorization token expired on ${expires.format()}`});
    }

    // Pass the controllers the decrypted body and the client's _id
    req.clientId = _id;
    if(req.body.encrypted) {
      req.decrypted = JSON.parse(decrypt(req.body.encrypted, sessionKey));
    }
  }

    // If JSON couldn't be parsed, the token was
  catch(err) {
    console.error(err);
    return res.status(401).send({message: `Invalid authorization key provided`})
  }

  next()
};


// Endpoints for Inter service communication (MUST BE BEFORE AUTHENTICATOR)
app.post('/notify', ClientController.notifyNewFile);
app.put('/notify', ClientController.notifyUpdatedFile);
app.delete('/remoteFile/:clientId/:_id', ClientController.notifyDeletedRemoteFile);


app.use(authenticator);


// Endpoints for clients
app.get('/remoteFile/read', ClientController.getReadRemoteFileURL);
app.get('/remoteFile/write', ClientController.getMasterServer);
app.get('/remoteFile/:_id', ClientController.getRemoteFileInfoById);
app.get('/remoteFiles', ClientController.getRemoteFiles);
app.get('/publicFiles', ClientController.getAllPublicFiles);
app.post('/sharedFile', ClientController.registerSharedFile);



// Initialize the Server
const port = process.argv[2] || process.env.port || 3001;
app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});


/**
 * Decrypts the data using parameters defined in .env file
 * @param data to be decrypted
 * @param key used during the encryption
 */
function decrypt(data, key=encryption.serverKey) {
  const { algorithm, plainEncoding, encryptedEncoding } = encryption;

  const decipher = crypto.createDecipher(algorithm, key);
  let deciphered = decipher.update(data, encryptedEncoding, plainEncoding);
  deciphered += decipher.final(plainEncoding);

  return deciphered
}

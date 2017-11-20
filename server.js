import express from 'express';
import mongoose from 'mongoose';

import bodyParser from 'body-parser';
import morgan from 'morgan';
import jwt from 'jsonwebtoken';



// Import Controllers
import ClientController from './controllers/ClientController';

const app = express();


// Initialize .env
require('dotenv').config();


// Initialize the DB
const dbURL = "mongodb://localhost/dfs_directoryService";
mongoose.connect(dbURL);
const db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', function() {
  console.log("Connected to Database");
});


// Register middleware (Must be done before CRUD handlers)
app.use(bodyParser.urlencoded({extended: true}));   // Parses application/x-www-form-urlencoded for req.body
app.use(bodyParser.json());                         // Parses application/json for req.body
app.use(morgan('dev'));

// expose environment variables to app
// app.set('jwtSecret', process.env.JWT_SECRET);


// Unauthenticated
app.post('/register', ClientController.register);

// Client
app.get('/remoteFile/:filename', ClientController.getRemoteFileURL);
app.get('/remoteFiles/:email', ClientController.getRemoteFiles);
app.get('/remoteHost', ClientController.getRemoteHost);


// Inter service communication
app.post('/notify', ClientController.notifyNewFile);


// Initialize the Server
app.listen(3001, function() {
  console.log('Listening on port 3001');
});

const Client = require('../models/Client').Client;
const hashPassword = require('../models/Client').hashPassword;

const fs = require('fs');
const path = require('path');

let availableNodes = ['localhost:3000'];//, '10.62.0.57:3000'];
let nextNode = 0;


/**
 * POST /register
 * Register for an account with the directory service
 */
const register = async (req, res) => {
  const { email, password, name } = req.body;
  let client = await Client.findOne({ email });

  if(client) {
    return res.status(409).send(`Account under ${email} already exists!`);
  }

  client = new Client({email, name});
  client.password = hashPassword(password);

  try {
    client.save();
    console.log(`${email} added`);
    res.send(`Account for ${email} successfully created`)
  } catch (error) {
    res.status(403).send(error);
  }
};



/**
 * GET /remoteFile/:filename
 * Gets the remote url of our file
 */

// TODO: Implement token stuff for identity / auth
const getRemoteFileURL = async (req, res) => {
  const { filename } = req.params;
  const email = "lupos@tcd.ie";
  const client = await Client.findOne({email});
  if(!client) {
    return res.status(401).send(`No user with email address: ${email}`);
  }

  return client.files.forEach((file) => {
    if(file.clientFileName === filename) {
      console.log("Found match");
      return res.send({
        remoteFile: `${file.remoteNodeAddress}/file/${file.remoteFileId}`
      });
    }
  });

  res.status(404).send(`No remote match for ${filename}`);
};

/**
 * GET /remoteFiles
 * Returns clients available remote files
 */
const getRemoteFiles = async (req, res) => {
  const { email } = req.params;
  const client = await Client.findOne({email});
  if(!client) {
    return res.status(401).send(`No user with email address: ${email}`);
  }

  res.send(client.files);
};


/**
 * GET remoteHost
 * Gets a host for a client to upload a client to
 */
const getRemoteHost = async (req, res) => {
  res.send(`${availableNodes[nextNode]}/file`);
  nextNode = (++nextNode) % availableNodes.length;
};

/**
 * GET publicFiles
 * Gets all of the available remote hosts
 */
const getAllPublicFiles = async (req, res) => {
  let publicFiles = [];
  const clients = await Client.find({});
  clients.forEach(client => {
    publicFiles.push(client.files.filter(file => !file.private));
  });


  res.send(publicFiles)
};



/**
 * POST notify
 * Notify the directory service of a new file belonging to some client
 */
const notifyNewFile = async (req, res) => {
  const { email, file } = req.body;
  const client = await Client.findOne({email});
  if(!client) {
    console.log("Error: unknown client created a file on remote server!");
    return;
  }

  client.files.push(file);

  try {
    await client.save();
    res.send(`${email}'s files updated.`)
  } catch (error) {
    console.log(`Error updating ${email}'s files`);
    res.status(500).send(`Error updating ${email}'s files`);
  }

};


module.exports = {
  register,
  getRemoteFileURL,
  getRemoteFiles,
  getRemoteHost,
  getAllPublicFiles,
  notifyNewFile,
};



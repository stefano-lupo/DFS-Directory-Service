

let mongoose = require('mongoose');
let bcrypt = require('bcrypt-nodejs');


// Define fields
let clientSchema = mongoose.Schema({
  name: String,
  email: String,
  password: String,
  createdOn: Date,
  lastLogIn: Date,
  files: [
    {
      clientFileName: String,
      private: {
        type: Boolean,
        default: false
      },
      remoteNodeAddress: String,
      remoteFileId: String,
    }
  ]
});

// Define methods
clientSchema.methods.isValidPassword = function (password) {
  console.log("checking password");
  return bcrypt.compareSync(password, this.password)
};

// Compile schema into model BEFORE compilation
let Client = mongoose.model('Client', clientSchema);

function hashPassword(password) {
  console.log("hashing password");
  return bcrypt.hashSync(password, null);
}

module.exports = {
  Client,
  hashPassword
};

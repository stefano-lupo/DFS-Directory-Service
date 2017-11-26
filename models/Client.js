import mongoose from 'mongoose';

// Define fields
let clientSchema = mongoose.Schema({
  files: [
    {
      clientFileName: String,
      isPrivate: {
        type: Boolean,
        default: false
      },
      remoteNodeAddress: String,
      remoteFileId: mongoose.SchemaTypes.ObjectId,
    }
  ]
});

// Compile schema into model BEFORE compilation
let Client = mongoose.model('Client', clientSchema);

module.exports = {
  Client,
};

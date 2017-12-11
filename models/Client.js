import mongoose from 'mongoose';

// Define fields for Clients in the Directory Service Database
let clientSchema = mongoose.Schema({
  files: [
    {
      clientFileName: String,
      isPrivate: {
        type: Boolean,
        default: false
      },
      slaves: Array,
      remoteFileId: mongoose.SchemaTypes.ObjectId,
    }
  ]
});

export const Client = mongoose.model('Client', clientSchema);
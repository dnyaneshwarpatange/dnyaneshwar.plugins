const mongoose = require('mongoose');

const pluginSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['jira', 'confluence'],
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  marketplaceUrl: {
    type: String,
    required: true,
    trim: true
  },
  currentVersion: {
    type: String,
    required: true,
    trim: true
  },
  notes: {
    type: String,
    trim: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

pluginSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Plugin', pluginSchema);

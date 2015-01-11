'use strict';

var eejs = require('ep_etherpad-lite/node/eejs');
var exportMoinMoin = require('./ExportMoinMoin');

exports.expressCreateServer = function (hookName, args, cb) {
  args.app.get('/p/:pad/:rev?/export/moinmoin', function (req, res, next) {
    var padID = req.params.pad;
    var revision = req.params.rev ? req.params.rev : null;

    exportMoinMoin.getPadMoinMoinDocument(padID, revision, function (err, result) {
      res.contentType('text/plain');
      res.send(result);
    });
  });
};

exports.eejsBlock_exportColumn = function (hookName, args, cb) {
  args.content = args.content + eejs.require('ep_moinmoin_export/templates/exportcolumn.html', {}, module);
  return cb();
};

exports.eejsBlock_scripts = function (hookName, args, cb) {
  args.content = args.content + eejs.require('ep_moinmoin_export/templates/scripts.html', {}, module);
  return cb();
};

exports.eejsBlock_styles = function (hookName, args, cb) {
  args.content = args.content + eejs.require('ep_moinmoin_export/templates/styles.html', {}, module);
  return cb();
};
/**
 * Copyright 2009 Google Inc.
 * Copyright 2015 Holger Cremer
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS-IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

var async = require('ep_etherpad-lite/node_modules/async');
var Changeset = require('ep_etherpad-lite/static/js/Changeset');
var padManager = require('ep_etherpad-lite/node/db/PadManager');
var ERR = require('ep_etherpad-lite/node_modules/async-stacktrace');

var INFO_PREFIX =
  '# Exported from Etherpad to MoinMoin ( https://github.com/smilix/ep_moinmoin_export ).\n' +
  '# tip: Use <<BR>> or an extra blank line for a new line.\n';

function _analyzeLine(text, aline, apool) {
  var line = {};

  // identify list
  var lineMarker = 0;
  line.listLevel = 0;
  if (aline) {
    var opIter = Changeset.opIterator(aline);
    if (opIter.hasNext()) {
      var listType = Changeset.opAttributeValue(opIter.next(), 'list', apool);
      if (listType) {
        lineMarker = 1;
        listType = /([a-z]+)([12345678])/.exec(listType);
        if (listType) {
          line.listTypeName = listType[1];
          line.listLevel = Number(listType[2]);
        }
      }
    }
  }
  if (lineMarker) {
    line.text = text.substring(1);
    line.aline = Changeset.subattribution(aline, 1);
  }
  else {
    line.text = text;
    line.aline = aline;
  }

  return line;
}

function getMoinMoinFromAtext(pad, atext) {
  var apool = pad.apool();
  var textLines = atext.text.slice(0, -1).split('\n');
  var attribLines = Changeset.splitAttributionLines(atext.attribs, atext.text);

  var tags = [
    ['\'\'\'', '\'\'\''],
    ['\'\'', '\'\'' ],
    ['__', '__'],
    ['--(', ')--']
  ];
  var props = ['bold', 'italic', 'underline', 'strikethrough'];
  var anumMap = {};

  props.forEach(function (propName, i) {
    var propTrueNum = apool.putAttrib([propName, true], true);
    if (propTrueNum >= 0) {
      anumMap[propTrueNum] = i;
    }
  });

  var codeTags = [ '{{{\n', '\n}}}'];
  var headingtags = [
    [ '= ', ' ='],
    [ '== ', ' =='],
    ['=== ', ' ==='],
    ['==== ', ' ===='],
    ['===== ', ' ====='],
    ['====== ', ' ======'],
    codeTags
  ];
  var headingprops = [
    ['heading', 'h1'],
    ['heading', 'h2'],
    ['heading', 'h3'],
    ['heading', 'h4'],
    ['heading', 'h5'],
    ['heading', 'h6'],
    ['heading', 'code']
  ];
  var headinganumMap = {};

  headingprops.forEach(function (prop, i) {
    var name;
    var value;
    if (typeof prop === 'object') {
      name = prop[0];
      value = prop[1];
    } else {
      name = prop;
      value = true;
    }
    var propTrueNum = apool.putAttrib([name, value], true);
    if (propTrueNum >= 0) {
      headinganumMap[propTrueNum] = i;
    }
  });

  function getLineMoinMoin(text, attribs, lastLineState) {
    var propVals = [false, false, false];
    var ENTER = 1;
    var STAY = 2;
    var LEAVE = 0;
    var newLineState = {};

    // Use order of tags (b/i/u) as order of nesting, for simplicity
    // and decent nesting.  For example,
    // <b>Just bold<b> <b><i>Bold and italics</i></b> <i>Just italics</i>
    // becomes
    // <b>Just bold <i>Bold and italics</i></b> <i>Just italics</i>
    var taker = Changeset.stringIterator(text);
    var assem = Changeset.stringAssembler();

    var openTags = [];

    function emitOpenTag(i) {
      openTags.unshift(i);
      assem.append(tags[i][0]);
    }

    function emitCloseTag(i) {
      openTags.shift();
      assem.append(tags[i][1]);
    }

    function orderdCloseTags(tags2close) {
      for (var i = 0; i < openTags.length; i++) {
        for (var j = 0; j < tags2close.length; j++) {
          if (tags2close[j] === openTags[i]) {
            emitCloseTag(tags2close[j]);
            i--;
            break;
          }
        }
      }
    }

    // start heading check
    var heading = false;
    var deletedAsterisk = false; // we need to delete * from the beginning of the heading line
    var iter2 = Changeset.opIterator(Changeset.subattribution(attribs, 0, 1));
    if (iter2.hasNext()) {
      var o2 = iter2.next();

      // iterate through attributes
      Changeset.eachAttribNumber(o2.attribs, function (a) {

        if (a in headinganumMap) {
          var i = headinganumMap[a]; // i = 0 => bold, etc.
          heading = headingtags[i];
          if (apool.numToAttrib[a][1] === 'code') {
            newLineState.codeLine = true;
          }
        }
      });
    }

    if (lastLineState.codeLine) {
      if (!newLineState.codeLine) {
        // close code block
        assem.append(codeTags[1]);
      }
    } else {
      if (heading) {
        assem.append(heading[0]);
      }
    }


    var idx = 0;

    function processNextChars(numChars) {
      if (numChars <= 0) {
        return;
      }

      var iter = Changeset.opIterator(Changeset.subattribution(attribs, idx, idx + numChars));
      idx += numChars;

      var i;
      var tags2close;
      while (iter.hasNext()) {
        var o = iter.next();
        var propChanged = false;
        Changeset.eachAttribNumber(o.attribs, function (a) {
          if (a in anumMap) {
            var i = anumMap[a]; // i = 0 => bold, etc.
            if (!propVals[i]) {
              propVals[i] = ENTER;
              propChanged = true;
            }
            else {
              propVals[i] = STAY;
            }
          }
        });
        for (i = 0; i < propVals.length; i++) {
          if (propVals[i] === true) {
            propVals[i] = LEAVE;
            propChanged = true;
          }
          else if (propVals[i] === STAY) {
            propVals[i] = true; // set it back
          }
        }

        // now each member of propVal is in {false,LEAVE,ENTER,true}
        // according to what happens at start of span
        if (propChanged) {
          // leaving bold (e.g.) also leaves italics, etc.
          var left = false;
          for (i = 0; i < propVals.length; i++) {
            var v = propVals[i];
            if (!left) {
              if (v === LEAVE) {
                left = true;
              }
            }
            else {
              if (v === true) {
                propVals[i] = STAY; // tag will be closed and re-opened
              }
            }
          }

          tags2close = [];

          for (i = propVals.length - 1; i >= 0; i--) {
            if (propVals[i] === LEAVE) {
              //emitCloseTag(i);
              tags2close.push(i);
              propVals[i] = false;
            }
            else if (propVals[i] === STAY) {
              //emitCloseTag(i);
              tags2close.push(i);
            }
          }

          orderdCloseTags(tags2close);

          for (i = 0; i < propVals.length; i++) {
            if (propVals[i] === ENTER || propVals[i] === STAY) {
              emitOpenTag(i);
              propVals[i] = true;
            }
          }
          // propVals is now all {true,false} again
        } // end if (propChanged)
        var chars = o.chars;
        if (o.lines) {
          chars--; // exclude newline at end of line, if present
        }

        var s = taker.take(chars);

        //removes the characters with the code 12. Don't know where they come
        //from but they break the abiword parser and are completly useless
        s = s.replace(String.fromCharCode(12), '');

        // delete * if this line is a heading
        if (heading && !deletedAsterisk) {
          s = s.substring(1);
          deletedAsterisk = true;
        }

        assem.append(s);
      } // end iteration over spans in line

      tags2close = [];
      for (i = propVals.length - 1; i >= 0; i--) {
        if (propVals[i]) {
          tags2close.push(i);
          propVals[i] = false;
        }
      }

      orderdCloseTags(tags2close);
    } // end processNextChars

    processNextChars(text.length - idx);

    if (heading && !newLineState.codeLine) {
      assem.append(heading[1]);
    }

    return {
      content: assem,
      state: newLineState
    };
  } // end getLineMoinMoin

  var pieces = [];

  var lastLineState = {};
  for (var i = 0; i < textLines.length; i++) {
    var line = _analyzeLine(textLines[i], attribLines[i], apool);
    var lineObj = getLineMoinMoin(line.text, line.aline, lastLineState);
    lastLineState = lineObj.state;

    if (line.listLevel && lineObj.content) {
      var listChar = ''; // also default char
      if (line.listTypeName === 'number') {
        listChar = '1. ';
      } else if (line.listTypeName === 'bullet') {
        listChar = '* ';
      }
      pieces.push(new Array(line.listLevel + 1).join(' ') + listChar);
    }
    pieces.push(lineObj.content, '\n');
  }

  if (lastLineState.codeLine) {
    // add missing code block closing tag
    pieces.push(codeTags[1]);
  }


  return INFO_PREFIX +
    pieces.join('');
}


function getPadMoinMoin(pad, revNum, callback) {
  var atext = pad.atext;
  var moinMoinMarkup;
  async.waterfall([

      // fetch revision atext
      function (callback) {
        if (revNum) {
          pad.getInternalRevisionAText(revNum, function (err, revisionAtext) {
            if (ERR(err, callback)) {
              return;
            }
            atext = revisionAtext;
            callback();
          });
        }
        else {
          callback(null);
        }
      },

      // convert atext to moin moin markup
      function (callback) {
        moinMoinMarkup = getMoinMoinFromAtext(pad, atext);
        callback(null);
      }],

    // run final callback
    function (err) {
      if (ERR(err, callback)) {
        return;
      }
      callback(null, moinMoinMarkup);
    });
}

exports.getPadMoinMoinDocument = function (padId, revNum, callback) {
  padManager.getPad(padId, function (err, pad) {
    if (ERR(err, callback)) {
      return;
    }

    getPadMoinMoin(pad, revNum, function (err, latex) {
      if (ERR(err, callback)) {
        return;
      }
      callback(null, latex);
    });
  });
};


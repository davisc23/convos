(function() {
  Convos.Dialog = function(attrs) {
    var self = this;

    EventEmitter(this);
    this.active = undefined;
    this.connection_id = attrs.connection_id;
    this.dialog_id = attrs.dialog_id;
    this.frozen = attrs.frozen || "";
    this.is_private = attrs.is_private || true;
    this.lastActive = 0;
    this.lastRead = attrs.last_read ? Date.fromAPI(attrs.last_read) : new Date(0);
    this.loading = false;
    this.messages = [];
    this.name = attrs.name || attrs.dialog_id.toLowerCase() || "";
    this.reset = attrs.hasOwnProperty("reset") ? attrs.reset : true;
    this.topic = attrs.topic || "";
    this.unread = 0;
    this.user = attrs.user || new Convos.User({});
    this._participants = {};
  };

  var proto = Convos.Dialog.prototype;
  var protectedKeys = ["connection_id", "dialog_id", "name", "participants", "user"];

  proto.addMessage = function(msg, args) {
    if (!args) args = {};
    if (!args.method) args.method = "push";
    if (!msg.from) msg.from = "convosbot";
    if (!msg.type) msg.type = "notice";
    if (!msg.ts) msg.ts = new Date();
    if (typeof msg.ts == "string") msg.ts = Date.fromAPI(msg.ts);
    if (args.method == "push") this._processNewMessage(msg);
    if (args.type == "participants") this._setParticipants(msg);
    if (!this.dialog_id) this._processNewServerMessage(msg);

    var prev = args.method == "unshift" ? this.messages[0] : this.messages.slice(-1)[0];
    if (prev && prev.ts.getDate() != msg.ts.getDate()) {
      this.messages[args.method]({type: "day-changed", ts: msg.ts});
    }

    this.messages[args.method](msg);
    this.participant({nick: msg.from, seen: msg.ts});
    this.emit("message", msg);
  };

  proto.connection = function() {
    return this.user.getConnection(this.connection_id);
  };

  // Create a href for <a> tag
  proto.href = function() {
    var path = Array.prototype.slice.call(arguments);
    if (!this.connection()) return "#chat/convos-local/convosbot";
    return ["#chat", this.connection_id, this.dialog_id].concat(path).join("/");
  };

  proto.icon = function() {
    return !this.dialog_id ? "device_hub" : this.is_private ? "person" : "group";
  };

  proto.load = function(args, cb) {
    var self = this;
    var method = this.dialog_id ? "dialogMessages" : "connectionMessages";
    var processMethod = args.historic ? "_processHistoricMessages" : "_processMessages";
    var first = this.messages.slice(0)[0];

    if (this.loading) return cb(null, {});
    if (first && first.end && args.historic) return cb(null, {});
    if (DEBUG.info) console.log("[load:" + this.dialog_id + "] " + JSON.stringify(args)); // TODO
    if (args.historic && this.messages.length > 0) args.before = this.messages[0].ts.toISOString();

    delete args.historic;
    args.connection_id = this.connection_id;
    args.dialog_id = this.dialog_id;
    this.loading = true;

    Convos.api[method](args, function(err, xhr) {
      if (self.reset) self.messages = [];
      self.loading = false;
      self._locked = true;
      self[processMethod](err, xhr.body.messages).reverse().forEach(function(msg) {
        self.addMessage(msg, {method: "unshift"});
      });
      cb(err, xhr.body);
      self._locked = false;
      self.reset = false;
    });
  };

  proto.participant = function(data) {
    // get
    if (typeof data == "string") return this._participants[data] || {};

    // set
    if (data.dialog_id && data.dialog_id != this.dialog_id) return;
    if (!data.nick) data.nick = data.new_nick || data.name;

    var participant = this._participants[data.nick] || {name: data.nick, seen: new Date(0)};
    if (data.mode) participant.mode = data.mode;
    if (data.seen && participant.seen < data.seen) participant.seen = data.seen;
    if (data.hasOwnProperty("online")) participant.online = data.online;

    switch (data.type) {
      case "join":
        participant.online = true;
        this.addMessage({message: data.nick + " joined.", from: this.connection_id});
        break;
      case "nick_change":
        if (!this._participants[data.old_nick]) return;
        participant.online = true;
        Vue.delete(this._participants, data.old_nick);
        this.addMessage({message: data.old_nick + " changed nick to " + data.nick + ".", from: this.connection_id});
        break;
      case "part":
      case "quit":
        if (!this._participants[data.nick]) return;
        var message = data.nick + " parted.";
        participant.online = false;
        if (data.kicker) message = data.nick + " was kicked by " + data.kicker + ".";
        if (data.message) message += " Reason: " + data.message;
        this.addMessage({message: message, from: this.connection_id});
    }

    Vue.set(this._participants, data.nick, participant);
  };

  proto.participants = function() {
    var obj = this._participants;
    return Object.keys(obj).sort().map(function(k) { return obj[k]; });
  };

  proto.setLastRead = function() {
    Convos.api[this.dialog_id ? "setDialogLastRead" : "setConnectionLastRead"](
      {
        connection_id: this.connection_id,
        dialog_id: this.dialog_id
      }, function(err, xhr) {
        if (err) return console.log("[setDialogLastRead:" + self.dialog_id + "] " + JSON.stringify(err)); // TODO
        self.lastRead = Date.fromAPI(xhr.body.last_read);
      }
    );
  };

  proto.update = function(attrs) {
    var stateChange = attrs.hasOwnProperty("active") || attrs.hasOwnProperty("frozen");
    var wasInactive = this.active ? false : true;

    if (attrs.hasOwnProperty("active")) this.unread = 0;
    if (attrs.hasOwnProperty("active") && this.active && !attrs.active) this.setLastRead();
    if (attrs.hasOwnProperty("frozen") && this.frozen && !attrs.frozen) this.reset = true;

    Object.keys(attrs).forEach(function(n) {
      if (this.hasOwnProperty(n) && protectedKeys.indexOf(n) == -1) this[n] = attrs[n];
    }.bind(this));

    if (this.reset && this.active) {
      this.load({}, function() {});
    }

    if (this.is_private && this.dialog_id) {
      this.participant({online: this.frozen ? false : true, nick: this.name});
      this.participant({online: true, nick: this.connection().me.nick || "me"});
      if (wasInactive && this.active) this.connection().send("/ison " + this.name, this);
    }

    if (!this.is_private && stateChange && !this.frozen && this.active) {
      this.connection().send("/names", this, this._setParticipants.bind(this));
    }

    return this;
  };

  proto._processHistoricMessages = function(err, messages) {
    if (err) {
      messages = [{message: err[0].message || "Unknown error.", type: "error"}];
    }
    else if (this.messages.length && !messages.length) {
      messages.unshift({end: true, message: "End of history."});
    }

    return messages;
  };

  proto._processMessages = function(err, messages) {
    var frozen = this.frozen.ucFirst();

    if (err) {
      messages = [{message: err[0].message || "Unknown error.", type: "error"}];
    }
    else if (frozen.match(/password/i)) {
      messages.push({type: "password"});
    }
    else if (frozen) {
      messages.push({message: this.dialog_id ? "You are not part of this dialog. " + frozen : frozen, type: "error"});
    }
    else if (!messages.length && this.messages.length <= 1) {
      messages.push({message: this.is_private ? "What do you want to say to " + this.name + "?" : "You have joined " + this.name + ", but no one has said anything as long as you have been here."});
    }

    if (Convos.settings.notifications == "default") {
      messages.push({type: "enable-notifications"});
    }

    return messages;
  };

  proto._processNewMessage = function(msg) {
    this.lastActive = msg.ts.valueOf();

    if (!msg.type.match(/^(action|private)$/)) return;
    if (this.lastRead < msg.ts) this.unread++;
    if (this._locked) return;

    if (msg.highlight) {
      this.user.unread++;
      this.user.notifications.unshift(msg);
      Notification.simple(msg.from, msg.message);
    }
    else if (this.is_private && this.dialog_id) {
      Notification.simple(msg.from, msg.message);
    }
  };

  proto._processNewServerMessage = function(msg) {
    if (msg.type == "notice") msg.type = "private";
    if (msg.message.indexOf("- ") == 0) msg.motd = true; // experimental MOTD handling
  };

  proto._setParticipants = function(msg) {
    if (msg.errors) return this.addMessage({type: "error", message: msg.errors[0].message});
    this.participants().forEach(function(p) { p.online = false; });
    msg.participants.forEach(function(p) {
      p.online = true;
      this.participant(p);
    }.bind(this));
  };
})();

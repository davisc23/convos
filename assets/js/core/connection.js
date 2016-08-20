(function() {
  Convos.Connection = function(attrs) {
    EventEmitter(this);
    this.id          = "";
    this.name        = "";
    this.me          = {nick: ""};
    this.protocol    = "unknown";
    this.sendTimeout = 5000; // is this long enough?
    this.state       = "disconnected";
    this.url         = "";
    this._api        = Convos.api;
    this.on("message", this._onMessage);
    this.on("sent", this._onSent);
    this.on("state", this._onState);
    if (attrs) this.update(attrs);
  };

  var proto = Convos.Connection.prototype;

  proto.getDialog = function(dialog_id) {
    return this.user.dialogs.filter(function(d) {
      return d.connection_id == this.id && d.id == dialog_id;
    }.bind(this))[0];
  };

  proto.href = function() {
    return ["#connection", this.protocol, this.name].join("/");
  };

  // Human readable version of state
  proto.humanState = function() {
    return this.state.ucFirst();
  };

  proto.nick = function() {
    return this.me.nick ? this.me.nick : this.url.parseUrl().query.nick || "";
  };

  proto.notice = function(message) {
    var dialog = this.user.getActiveDialog();
    if (dialog) dialog.addMessage({from: this.id, message: message, type: "notice"});
  };

  // Remove this connection from the backend
  proto.remove = function(cb) {
    var self = this;
    this._api.removeConnection({connection_id: this.id}, function(err, xhr) {
      if (!err) {
        self.unsubscribe("message").unsubscribe("state");
        self.user.connections = self.user.connections.filter(function(c) {
          return c.id != self.id;
        });
        self.user.dialogs = self.user.dialogs.filter(function(d) {
          return d.connection_id != self.id;
        });
      }
      cb.call(self, err);
    });
    return this;
  };

  // Get list of available rooms on server
  proto.rooms = function(cb) {
    var self = this;
    this._api.rooms({connection_id: this.id}, function(err, xhr) {
      if (err) return cb.call(self, err, []);
      cb.call(self, err, xhr.body.rooms);
    });
    return this;
  };

  // Write connection settings to server
  proto.save = function(cb) {
    var self = this;

    // It is currently not possible to specify "name"
    var attrs = {
      url: this.url
    };

    if (this.id) {
      this._api.updateConnection(
        {
          body:          attrs,
          connection_id: this.id
        }, function(err, xhr) {
          if (err) return cb.call(self, err);
          self.update(xhr.body);
          cb.call(self, err);
        }
      );
    } else {
      this._api.createConnection({
        body: attrs
      }, function(err, xhr) {
        if (err) return cb.call(self, err);
        self.update(xhr.body);
        self.id = xhr.body.connection_id;
        self.user.connections.push(self);
        cb.call(self, err);
      });
    }
    return this;
  };

  proto.send = function(message, dialog) {
    var self = this;
    var action = message.match(/^\/(\w+)\s*(\S*)/) || ['', 'message', ''];
    var handler = "_sent" + action[1].toLowerCase().ucFirst();
    var id;

    if (!dialog) dialog = this.getDialog(action[2]); // action = ["...", "close", "#foo" ]
    if (!dialog) dialog = this.user.getActiveDialog();

    id = setTimeout(
      function() {
        self.off("sent-" + id);
        self.user.getActiveDialog().addMessage({
          from: "convosbot",
          type: "error",
          message: "Could not send message to " + (dialog ? dialog.name : this.id) + ": " + message,
        });
      },
      self.sendTimeout
    );

    // Handle echo back from backend
    this.once("sent-" + id, function(msg) {
      if (dialog) msg.dialog_id = dialog.id;
      return self[handler] ? self[handler](msg) : console.log("No handler for " + handler);
    });

    Convos.ws.send({
      id:            id,
      method:        "send",
      message:       message,
      connection_id: this.id,
      dialog_id:     dialog ? dialog.id : ""
    });

    return this;
  };

  proto.update = function(attrs) {
    var self = this;
    Object.keys(attrs).forEach(function(n) {
      self[n] = attrs[n];
    });
  };

  proto._onMessage = function(msg) {
    if (msg.dialog_id) return this.user.ensureDialog(msg).addMessage(msg);
    var dialog = this.user.getActiveDialog();
    if (dialog) dialog.addMessage(msg);
  };

  proto._onSent = function(msg) {
    if (DEBUG) console.log("[sent] " + JSON.stringify(msg));
    clearTimeout(msg.id);
    this.emit("sent-" + msg.id, msg);
  };

  proto._sentClose = proto._sentPart = function(msg) {
    this.user.dialogs = this.user.dialogs.filter(function(d) {
      return d.connection_id != this.id || d.id != msg.dialog_id;
    }.bind(this));
    Convos.settings.main = this.user.dialogs.length ? this.user.dialogs[0].href() : "";
  };

  proto._sentJoin = proto._sentJ = function(msg) {
    Convos.settings.main = this.user.ensureDialog(msg).href();
  };

  // "/nick ..." will result in {"event":"state","type":"me"}
  proto._sentNick = function(msg) {};

  proto._sentReconnect = function(msg) { this.notice('Reconnecting to ' + this.id + '...'); };

  // No need to handle echo from messages
  proto._sentMe = function(msg) {};
  proto._sentMessage = function(msg) {};
  proto._sentSay = function(msg) {};

  proto._sentWhois = function(data) {
    var dialog = this.user.getActiveDialog();
    if (!dialog) return;
    data.from = this.id;
    data.type = "whois";
    dialog.addMessage(data);
  };

  // TODO
  proto._sentKick = function(msg) { console.log('TODO: _sentKick()'); };
  proto._sentQuery = function(msg) { console.log('TODO: _sentQuery()'); };
  proto._sentTopic = function(msg) { console.log('TODO: _sentTopic()'); };

  proto._onState = function(data) {
    if (DEBUG) console.log("[state:" + data.type + "] " + this.href() + " = " + JSON.stringify(data));
    switch (data.type) {
      case "connection":
        var msg = data.state + '"';
        msg += data.message ? ': ' + data.message : ".";
        this.state = data.state;
        this.notice('Connection state changed to "' + msg);
        break;
      case "frozen":
        this.user.ensureDialog(data).frozen = data.frozen;
        break;
      case "join":
      case "part":
        this.user.ensureDialog(data).participant(data);
        break;
      case "nick_change":
        this.user.dialogs.forEach(function(d) {
          if (d.connection_id == data.connection_id) d.participant(data);
        });
        break;
      case "me":
        if (this.me.nick != data.nick) this.notice('You changed nick to ' + data.nick + '.');
        this.me.nick = data.nick;
        break;
    }
  };
})();

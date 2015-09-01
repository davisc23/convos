(function($) {
  // window.user is only for debug purposes and must not be accessed by riot tags
  window.user = new Convos.User().load(function(err) {
    if (err && err[0].path == '/X-Convos-Session') err = [];
    riot.mount(document.getElementById('app'), 'app', {errors: err || [], user: this});
    clearTimeout(Convos.loadTid); // Set in Convos.pm app.html.ep
  });
})(jQuery);
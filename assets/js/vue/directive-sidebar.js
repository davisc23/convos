(function() {
  // <a v-sidebar.literal="#notifications">...</a>
  Vue.directive("sidebar", {
    bind: function() {
      var vm = this.vm;
      this.el.addEventListener("click", function(e) {
        var href = e.currentTarget.href.replace(/.*?#/, "");
        var method = Convos.settings.sidebar == href ? "removeClass" : "addClass";
        e.preventDefault();
        Convos.settings.mainMenuVisible = false;
        Convos.settings.sidebar = Convos.settings.sidebar == href ? "" : href;
        $('body')[method]('has-sidebar');
      });
    },
    update: function(v) {
      this.el.href = v;
    }
  });
})();

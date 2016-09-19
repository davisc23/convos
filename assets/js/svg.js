(function($) {
  $('img[src$="svg"]').each(function() {
    var $img = $(this);
    $.get($img.attr("src"), function(data) {
      $img.replaceWith($(data).find("svg").removeAttr('xmlns:a').attr("class", $img.attr("class")));
    });
  });
})(jQuery);

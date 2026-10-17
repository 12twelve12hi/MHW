// Safari runs this in the page before the Send to Daylight share extension opens (NSExtensionJavaScriptPreprocessingFile).
// It hands the page as the user sees it (so paywalled and logged-in articles work), its address and its title to the
// extension, which sends a "page" item (or a "url" item when the page is too large).
var GetPage = function () {};

GetPage.prototype = {
  run: function (arguments) {
    var html = '';
    try {
      html = document.documentElement ? document.documentElement.outerHTML : '';
      if (html && document.doctype) {
        html = '<!doctype ' + document.doctype.name + '>\n' + html;
      }
    } catch (e) {
      html = '';
    }
    arguments.completionFunction({
      url: document.URL || location.href,
      title: document.title || '',
      html: html
    });
  },

  finalize: function (arguments) {}
};

var ExtensionPreprocessingJS = new GetPage();

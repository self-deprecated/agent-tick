const React = require("react");

function I18nProvider({ children }) {
  return React.createElement(React.Fragment, null, children);
}

module.exports = { I18nProvider };

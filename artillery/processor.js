// Derives the login credentials for whichever seed username this virtual
// user was assigned (see `config.variables.username` in socket-sanity.yml).
module.exports = { setAuthVars };

function setAuthVars(context, events, done) {
  const username = context.vars.username;
  context.vars.password = `${username}-dev-password`;
  context.vars.deviceFingerprint = `loadtest-${username}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return done();
}

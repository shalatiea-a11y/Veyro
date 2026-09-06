// Thin auth wrapper around Supabase Auth. Every page that requires a
// signed-in user calls Auth.requireSession() first.
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const Auth = (() => {
  async function requireSession() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
      window.location.href = "login.html";
      return null;
    }
    return session;
  }

  async function getProfile() {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabaseClient
      .from("profiles")
      .select("id, organization_id, full_name, role")
      .eq("id", user.id)
      .single();
    if (error) {
      console.error("Could not load profile — is this user linked in the profiles table?", error);
      return null;
    }
    return data;
  }

  async function signIn(email, password) {
    return supabaseClient.auth.signInWithPassword({ email, password });
  }

  async function signOut() {
    await supabaseClient.auth.signOut();
    window.location.href = "login.html";
  }

  return { requireSession, getProfile, signIn, signOut };
})();

// If the session ends (sign-out elsewhere, or the refresh token is revoked)
// while the app is open, bounce to login rather than continuing to render
// with stale/no auth.
supabaseClient.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT" && !location.pathname.endsWith("login.html")) {
    window.location.href = "login.html";
  }
});

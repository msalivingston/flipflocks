# Platform Admin Login

Platform administration uses `/admin/login`. Seller login remains `/login`.

Admin and seller logins still share the same Supabase browser session in this pass. Signing into one account in the same browser profile replaces the other active account. To use a seller account and a platform-admin account at the same time, use a different browser, browser profile, or incognito window.

Admin access is authorized through the database-backed platform admin role: `public.user_roles.role = 'admin'` with `store_id is null`. Browser code may ask the database whether the current authenticated session is a platform admin, but admin access must not be granted by matching an email string in client code.

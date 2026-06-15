import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../../auth/AuthContext";
import { EmptyState, FormField, ScannerResult } from "../../components/primitives";
import { DEFAULT_AUTHENTICATED_ROUTE } from "../routes/routes";

const BLOCKED_SIGN_IN_REDIRECTS = new Set([
  "/event-required",
  "/inactive-event",
  "/inactive-member",
  "/missing-terminal",
  "/no-access",
]);

export const SignInScreen = () => {
  const { authMode, error, signIn, status } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [password, setPassword] = useState("");

  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
  const redirectAfterSignIn = from && !BLOCKED_SIGN_IN_REDIRECTS.has(from)
    ? from
    : DEFAULT_AUTHENTICATED_ROUTE;

  if (status === "authenticated") {
    return <Navigate replace to={redirectAfterSignIn} />;
  }

  const handleSignIn = async () => {
    setIsSubmitting(true);
    const didSignIn =
      authMode === "mock"
        ? await signIn()
        : await signIn({
            email,
            password,
          });
    setIsSubmitting(false);

    if (didSignIn) {
      navigate(redirectAfterSignIn, { replace: true });
    }
  };

  return (
    <main className="login-screen">
      <section className="login-panel" aria-labelledby="login-title">
        <p className="eyebrow">Operations</p>
        <h1 id="login-title">Swoogo Check-in</h1>
        <p className="login-copy">Sign in to continue.</p>
        {error ? <p className="form-error">{error}</p> : null}
        {authMode === "firebase" ? (
          <>
            <FormField label="Email">
              <input
                autoComplete="email"
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                value={email}
              />
            </FormField>
            <FormField label="Password">
              <input
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                value={password}
              />
            </FormField>
          </>
        ) : null}
        <button
          className="button button-primary"
          disabled={isSubmitting}
          onClick={() => {
            void handleSignIn();
          }}
          type="button"
        >
          {isSubmitting ? "Signing in" : "Sign in"}
        </button>
      </section>
    </main>
  );
};

export const EventRequiredScreen = () => (
  <EmptyState
    description="Select an active event before opening an operational route."
    title="Event required"
  />
);

export const NoAccessScreen = () => (
  <EmptyState
    description="Your event role does not include access to this route."
    title="No access"
  />
);

export const InactiveMemberScreen = () => (
  <EmptyState
    description="Your event membership is inactive."
    title="Inactive member"
  />
);

export const InactiveEventScreen = () => (
  <EmptyState
    description="This event is not active or credentialing is disabled."
    title="Inactive event"
  />
);

export const MissingTerminalScreen = () => (
  <EmptyState
    description="Choose a terminal before opening this workflow."
    title="Terminal required"
  />
);

export const OperationalPlaceholderScreen = ({
  detail,
  title,
}: {
  detail: string;
  title: string;
}) => (
  <div className="page-stack">
    <header className="page-header">
      <div>
        <p className="eyebrow">Workflow</p>
        <h1>{title}</h1>
      </div>
    </header>
    <ScannerResult detail={detail} state="ready" title="Ready" />
  </div>
);

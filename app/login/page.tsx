import LoginForm from "./login-form";
import styles from "./login.module.css";

export default function LoginPage() {
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.mark}>▶</div>
        <span className={styles.eyebrow}>Persistent AI Video Studio</span>
        <h1>Owner access</h1>
        <p>Enter the private deployment password to open projects, profiles, generations, and Agent history.</p>
        <LoginForm />
        <small>Local development can run without owner auth when the auth environment variables are intentionally unset.</small>
      </section>
    </main>
  );
}

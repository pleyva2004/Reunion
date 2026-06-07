export default function Home() {
  return (
    <main style={{ fontFamily: 'system-ui', maxWidth: '32rem', margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Reunion · Calendar Integration</h1>
      <p>
        OAuth + availability service for the group-trip agent. Connect links are issued via
        <code> /connect?s=&lt;signed-token&gt;</code>. Availability is at{' '}
        <code>POST /api/availability</code>.
      </p>
    </main>
  );
}

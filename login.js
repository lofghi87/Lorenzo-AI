const client = window.supabase.createClient(
      'https://bknkgctmpgiuxvahbbzs.supabase.co',
      'sb_publishable_rZEaUwMU4CCl7kUPdUlvuw_cuX2n9hB'
    );

    const $ = id => document.getElementById(id);

    function message(text) {
      $('loginMessage').textContent = text;
    }

    function setBusy(busy) {
      $('submitBtn').disabled = busy;
      $('signupBtn').disabled = busy;
    }

    async function updatePage() {
      const { data, error } = await client.auth.getSession();

      if (error) {
        message('Impossibile verificare la sessione. Riprova.');
        return;
      }

      const user = data.session?.user;

      if (user) {
        $('formTitle').textContent = 'Sei già connesso.';
        $('formSubtitle').textContent = user.email;

        $('email').hidden = true;
        $('password').hidden = true;

        document.querySelectorAll('.login-card label').forEach(label => {
          label.hidden = true;
        });

        $('submitBtn').hidden = true;
        $('signupBtn').hidden = true;
        $('logoutBtn').hidden = false;

        message('Il tuo account è attivo.');
      }
    }

    $('loginForm').addEventListener('submit', async event => {
      event.preventDefault();

      setBusy(true);
      message('Accesso in corso…');

      const { error } = await client.auth.signInWithPassword({
        email: $('email').value.trim(),
        password: $('password').value
      });

      setBusy(false);

      if (error) {
        message(error.message);
        return;
      }

      message('Accesso riuscito. Apertura della chat…');
      window.location.replace('/');
    });

    $('signupBtn').addEventListener('click', async () => {
      const email = $('email').value.trim();
      const password = $('password').value;

      if (!$('loginForm').reportValidity()) return;

      setBusy(true);
      message('Creazione account in corso…');

      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.origin + '/login.html'
        }
      });

      setBusy(false);

      if (error) {
        message(error.message);
        return;
      }

      if (data.session) {
        window.location.replace('/');
        return;
      }

      message(
        'Account creato! Controlla la tua email e conferma la registrazione, poi torna qui per accedere.'
      );
    });

    $('logoutBtn').addEventListener('click', async () => {
      const { error } = await client.auth.signOut();

      if (error) {
        message(error.message);
        return;
      }

      window.location.reload();
    });

    client.auth.onAuthStateChange((event, session) => {
      if (
        event === 'SIGNED_IN' &&
        session &&
        !window.location.pathname.endsWith('/login.html')
      ) {
        window.location.replace('/');
      }
    });

    if (new URLSearchParams(window.location.search).get('accountDeleted') === '1') {
      message('Account eliminato. Tutti i dati rimossi dal servizio sono stati cancellati.');
    }

    updatePage();

// ─── SCROLL FADE-IN ANIMATIONS ───
const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      setTimeout(() => {
        entry.target.classList.add('visible');

        // Animate skill bars when they come into view
        const fill = entry.target.querySelector('.skill-fill');
        if (fill) {
          const w = fill.getAttribute('data-width');
          fill.style.width = w + '%';
        }
      }, 80);
    }
  });
}, { threshold: 0.15 });

// Observe all fade-up elements
document.querySelectorAll('.fade-up').forEach(el => observer.observe(el));

// Observe skill items for bar animation
document.querySelectorAll('.skill-item').forEach(el => observer.observe(el));


// ─── ACTIVE NAV LINK ON SCROLL ───
const sections = document.querySelectorAll('section[id]');
const navLinks = document.querySelectorAll('.nav-links a');

window.addEventListener('scroll', () => {
  let current = '';

  sections.forEach(section => {
    if (window.scrollY >= section.offsetTop - 100) {
      current = section.getAttribute('id');
    }
  });

  navLinks.forEach(link => {
    link.classList.remove('active');
    if (link.getAttribute('href') === '#' + current) {
      link.classList.add('active');
    }
  });
});


// ─── SMOOTH SCROLL FOR NAV CTA ───
const navCta = document.querySelector('.nav-cta');
if (navCta) {
  navCta.addEventListener('click', () => {
    document.getElementById('contact').scrollIntoView({ behavior: 'smooth' });
  });
}


// ─── CONTACT FORM → SEND TO GMAIL VIA EMAILJS ───
// ⚙️  HOW TO ACTIVATE (one-time setup, ~5 minutes):
//
//  1. Go to https://emailjs.com and create a FREE account
//  2. Click "Add New Service" → choose Gmail → connect emoeizzdipu@gmail.com
//     → copy the SERVICE ID (e.g. "service_abc123")
//  3. Click "Email Templates" → Create Template
//     Use these variables in the template body:
//       From:    {{from_name}}  <{{from_email}}>
//       Subject: {{subject}}
//       Message: {{message}}
//     → copy the TEMPLATE ID (e.g. "template_xyz789")
//  4. Click "Account" → copy your PUBLIC KEY (e.g. "aBcDeFgHiJ")
//  5. Paste all three values below & in the <script> tag in index.html

const EMAILJS_SERVICE_ID  = "Project-one-remastered";
const EMAILJS_TEMPLATE_ID = "template_ilfp9sg";
// Public Key is already set in index.html <head>

const contactForm = document.querySelector('.contact-form');
if (contactForm) {
  contactForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const btn       = contactForm.querySelector('.btn-primary');
    const nameVal   = contactForm.querySelector('input[type="text"]').value.trim();
    const emailVal  = contactForm.querySelector('input[type="email"]').value.trim();
    const subjectEl = contactForm.querySelectorAll('input[type="text"]')[1];
    const subjectVal= subjectEl ? subjectEl.value.trim() : 'Portfolio Contact';
    const msgVal    = contactForm.querySelector('textarea').value.trim();

    if (!nameVal || !emailVal || !msgVal) {
      btn.textContent = 'Please fill all fields!';
      btn.style.background = '#e53e3e';
      setTimeout(() => { btn.textContent = 'Send Message'; btn.style.background = ''; }, 2500);
      return;
    }

    btn.textContent = 'Sending…';
    btn.disabled = true;

    emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      from_name:  nameVal,
      from_email: emailVal,
      subject:    subjectVal,
      message:    msgVal,
      to_email:   'emoeizzdipu@gmail.com'
    })
    .then(() => {
      btn.textContent = '✓ Message Sent!';
      btn.style.background = '#22c55e';
      contactForm.reset();
      setTimeout(() => { btn.textContent = 'Send Message'; btn.style.background = ''; btn.disabled = false; }, 4000);
    })
    .catch((err) => {
      console.error('EmailJS error:', err);
      btn.textContent = 'Failed – Check Setup';
      btn.style.background = '#e53e3e';
      setTimeout(() => { btn.textContent = 'Send Message'; btn.style.background = ''; btn.disabled = false; }, 4000);
    });
  });
}

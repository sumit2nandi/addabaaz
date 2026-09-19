package in.addabaaz.contact;

import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Font;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.geom.AffineTransform;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Random;
import java.util.UUID;

import javax.imageio.ImageIO;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import in.addabaaz.common.BadRequestException;
import in.addabaaz.common.HashSupport;
import in.addabaaz.config.AddabaazProperties;

/**
 * Server-rendered image CAPTCHA, replacing the canvas one the old site drew in the browser.
 * The code itself is never stored — only its SHA-256 hash plus an expiry.
 */
@Service
@Transactional
public class CaptchaService {

  /** Characters that are unambiguous when distorted. */
  private static final char[] ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".toCharArray();
  private static final int WIDTH = 180;
  private static final int HEIGHT = 60;

  private final CaptchaRepository challenges;
  private final AddabaazProperties properties;
  private final Random random = new Random();

  public CaptchaService(CaptchaRepository challenges, AddabaazProperties properties) {
    this.challenges = challenges;
    this.properties = properties;
  }

  /** @return the challenge id plus a data-URL the browser can drop straight into an <img>. */
  public Challenge issue() {
    int length = Math.max(4, Math.min(properties.getCaptcha().getLength(), 8));
    StringBuilder code = new StringBuilder(length);
    for (int i = 0; i < length; i++) {
      code.append(ALPHABET[random.nextInt(ALPHABET.length)]);
    }

    CaptchaChallenge challenge = new CaptchaChallenge();
    challenge.setCodeHash(HashSupport.sha256(code.toString().toLowerCase()));
    challenge.setExpiresAt(Instant.now().plus(properties.getCaptcha().getTtl()));
    CaptchaChallenge saved = challenges.save(challenge);

    return new Challenge(saved.getId(), "data:image/png;base64," + render(code.toString()));
  }

  /** Consumes a challenge; throws if the code is wrong, expired or already used. */
  public void verify(UUID challengeId, String code) {
    if (challengeId == null || code == null || code.isBlank()) {
      throw new BadRequestException("Please complete the CAPTCHA.");
    }
    CaptchaChallenge challenge =
        challenges
            .findById(challengeId)
            .orElseThrow(() -> new BadRequestException("CAPTCHA expired — please refresh it."));
    if (!challenge.isUsable()) {
      throw new BadRequestException("CAPTCHA expired — please refresh it.");
    }
    if (!challenge.getCodeHash().equals(HashSupport.sha256(code.trim().toLowerCase()))) {
      // Wrong guesses invalidate the challenge so it cannot be brute forced.
      challenge.setConsumedAt(Instant.now());
      challenges.save(challenge);
      throw new BadRequestException("CAPTCHA did not match.");
    }
    challenge.setConsumedAt(Instant.now());
    challenges.save(challenge);
  }

  private String render(String code) {
    BufferedImage image = new BufferedImage(WIDTH, HEIGHT, BufferedImage.TYPE_INT_RGB);
    Graphics2D g = image.createGraphics();
    g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
    g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);

    g.setColor(new Color(245, 243, 255));
    g.fillRect(0, 0, WIDTH, HEIGHT);

    // noise
    List<Color> noise = List.of(
        new Color(124, 58, 237, 90),
        new Color(217, 70, 239, 80),
        new Color(34, 211, 238, 70));
    g.setStroke(new BasicStroke(2f));
    for (int i = 0; i < 24; i++) {
      g.setColor(noise.get(random.nextInt(noise.size())));
      int x1 = random.nextInt(WIDTH);
      int y1 = random.nextInt(HEIGHT);
      g.drawLine(x1, y1, random.nextInt(WIDTH), random.nextInt(HEIGHT));
    }

    // characters
    g.setFont(new Font(Font.SANS_SERIF, Font.BOLD, 34));
    int slot = WIDTH / (code.length() + 1);
    for (int i = 0; i < code.length(); i++) {
      g.setColor(new Color(40, 30, 70));
      AffineTransform original = g.getTransform();
      g.translate(slot * (i + 0.35), HEIGHT / 2d + 10);
      g.rotate((random.nextDouble() - 0.5) * 0.6);
      g.drawString(String.valueOf(code.charAt(i)), 0, 0);
      g.setTransform(original);
    }
    g.dispose();

    try {
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      ImageIO.write(image, "png", out);
      return Base64.getEncoder().encodeToString(out.toByteArray());
    } catch (Exception e) {
      throw new IllegalStateException("Could not render CAPTCHA image", e);
    }
  }

  public record Challenge(UUID id, String image) {}
}

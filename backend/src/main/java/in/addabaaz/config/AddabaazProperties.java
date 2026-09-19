package in.addabaaz.config;

import java.time.Duration;
import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** All addabaaz.* settings from application.yml. */
@ConfigurationProperties(prefix = "addabaaz")
public class AddabaazProperties {

  private final Cors cors = new Cors();
  private final Frontend frontend = new Frontend();
  private final Jwt jwt = new Jwt();
  private final Captcha captcha = new Captcha();
  private final Bootstrap bootstrap = new Bootstrap();

  public Cors getCors() {
    return cors;
  }

  public Frontend getFrontend() {
    return frontend;
  }

  public Jwt getJwt() {
    return jwt;
  }

  public Captcha getCaptcha() {
    return captcha;
  }

  public Bootstrap getBootstrap() {
    return bootstrap;
  }

  public static class Cors {
    private List<String> allowedOrigins = List.of("http://localhost:4200");

    public List<String> getAllowedOrigins() {
      return allowedOrigins;
    }

    public void setAllowedOrigins(List<String> allowedOrigins) {
      this.allowedOrigins = allowedOrigins;
    }
  }

  public static class Frontend {
    private String baseUrl = "http://localhost:4200";

    public String getBaseUrl() {
      return baseUrl;
    }

    public void setBaseUrl(String baseUrl) {
      this.baseUrl = baseUrl;
    }
  }

  public static class Jwt {
    private String secret = "addabaaz-dev-only-secret-please-replace-with-32-bytes-min";
    private String issuer = "addabaaz-api";
    private Duration accessTokenTtl = Duration.ofMinutes(15);
    private Duration refreshTokenTtl = Duration.ofDays(30);

    public String getSecret() {
      return secret;
    }

    public void setSecret(String secret) {
      this.secret = secret;
    }

    public String getIssuer() {
      return issuer;
    }

    public void setIssuer(String issuer) {
      this.issuer = issuer;
    }

    public Duration getAccessTokenTtl() {
      return accessTokenTtl;
    }

    public void setAccessTokenTtl(Duration accessTokenTtl) {
      this.accessTokenTtl = accessTokenTtl;
    }

    public Duration getRefreshTokenTtl() {
      return refreshTokenTtl;
    }

    public void setRefreshTokenTtl(Duration refreshTokenTtl) {
      this.refreshTokenTtl = refreshTokenTtl;
    }
  }

  public static class Captcha {
    private Duration ttl = Duration.ofMinutes(5);
    private int length = 5;

    public Duration getTtl() {
      return ttl;
    }

    public void setTtl(Duration ttl) {
      this.ttl = ttl;
    }

    public int getLength() {
      return length;
    }

    public void setLength(int length) {
      this.length = length;
    }
  }

  public static class Bootstrap {
    private final Admin admin = new Admin();

    public Admin getAdmin() {
      return admin;
    }

    public static class Admin {
      private boolean enabled = true;
      private String email = "admin@addabaaz.in";
      private String password = "Admin@123";
      private String fullName = "ADDABAAZ Admin";

      public boolean isEnabled() {
        return enabled;
      }

      public void setEnabled(boolean enabled) {
        this.enabled = enabled;
      }

      public String getEmail() {
        return email;
      }

      public void setEmail(String email) {
        this.email = email;
      }

      public String getPassword() {
        return password;
      }

      public void setPassword(String password) {
        this.password = password;
      }

      public String getFullName() {
        return fullName;
      }

      public void setFullName(String fullName) {
        this.fullName = fullName;
      }
    }
  }
}

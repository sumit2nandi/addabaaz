package in.addabaaz.common;

/** Thrown for invalid client input — mapped to HTTP 400. */
public class BadRequestException extends RuntimeException {

  public BadRequestException(String message) {
    super(message);
  }
}

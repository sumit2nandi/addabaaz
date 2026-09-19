package in.addabaaz.common;

/** Thrown when a write would duplicate a unique value — mapped to HTTP 409. */
public class ConflictException extends RuntimeException {

  public ConflictException(String message) {
    super(message);
  }
}

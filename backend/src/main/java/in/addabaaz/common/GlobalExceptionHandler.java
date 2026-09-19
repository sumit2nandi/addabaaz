package in.addabaaz.common;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** Turns exceptions into a consistent JSON error body: {error, message, ...}. */
@RestControllerAdvice
public class GlobalExceptionHandler {

  private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

  @ExceptionHandler(NotFoundException.class)
  ResponseEntity<Map<String, Object>> notFound(NotFoundException exception) {
    return body(HttpStatus.NOT_FOUND, exception.getMessage(), null);
  }

  @ExceptionHandler(BadRequestException.class)
  ResponseEntity<Map<String, Object>> badRequest(BadRequestException exception) {
    return body(HttpStatus.BAD_REQUEST, exception.getMessage(), null);
  }

  @ExceptionHandler(ConflictException.class)
  ResponseEntity<Map<String, Object>> conflict(ConflictException exception) {
    return body(HttpStatus.CONFLICT, exception.getMessage(), null);
  }

  @ExceptionHandler({
    BadCredentialsException.class,
    org.springframework.security.core.AuthenticationException.class
  })
  ResponseEntity<Map<String, Object>> unauthorized(Exception exception) {
    return body(HttpStatus.UNAUTHORIZED, "Invalid email or password.", null);
  }

  @ExceptionHandler(AccessDeniedException.class)
  ResponseEntity<Map<String, Object>> forbidden(AccessDeniedException exception) {
    return body(HttpStatus.FORBIDDEN, "You do not have access to this resource.", null);
  }

  @ExceptionHandler(MethodArgumentNotValidException.class)
  ResponseEntity<Map<String, Object>> validation(MethodArgumentNotValidException exception) {
    Map<String, String> fields = new LinkedHashMap<>();
    for (FieldError error : exception.getBindingResult().getFieldErrors()) {
      fields.putIfAbsent(error.getField(), error.getDefaultMessage());
    }
    return body(HttpStatus.BAD_REQUEST, "Validation failed.", fields);
  }

  @ExceptionHandler(HttpMessageNotReadableException.class)
  ResponseEntity<Map<String, Object>> unreadable(HttpMessageNotReadableException exception) {
    return body(HttpStatus.BAD_REQUEST, "Malformed request body.", null);
  }

  @ExceptionHandler(Exception.class)
  ResponseEntity<Map<String, Object>> fallback(Exception exception) {
    log.error("Unhandled exception", exception);
    return body(HttpStatus.INTERNAL_SERVER_ERROR, "Something went wrong.", null);
  }

  private static ResponseEntity<Map<String, Object>> body(
      HttpStatus status, String message, Map<String, String> fields) {
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("timestamp", Instant.now().toString());
    payload.put("status", status.value());
    payload.put("error", status.getReasonPhrase());
    payload.put("message", message);
    if (fields != null && !fields.isEmpty()) {
      payload.put("fields", fields);
    }
    return ResponseEntity.status(status).body(payload);
  }
}

package in.addabaaz;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class AddabaazApiApplication {

  public static void main(String[] args) {
    SpringApplication.run(AddabaazApiApplication.class, args);
  }
}
